import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** Istanbul 19:00 on the given day of October 2026. */
const day = (d: number) => new Date(Date.UTC(2026, 9, 13 + d, 16, 0));

async function segment(page: Page): Promise<string> {
  return (await page.locator('.seg-title h1').textContent()) ?? '';
}

/** Runs `act` and waits until the element it acted on has been replaced. */
async function step(page: Page, selector: string, act: () => Promise<void>) {
  const handle = await page.locator(selector).first().elementHandle();
  await act();
  if (handle) await handle.waitForElementState('hidden');
}

async function doReview(page: Page) {
  while ((await segment(page)) === 'Tekrar') {
    await step(page, '.exercise', async () => {
      const reveal = page.getByRole('button', { name: 'Anlamını göster' });
      if (await reveal.isVisible()) {
        await reveal.click();
        await page.getByRole('button', { name: 'Bildim' }).click();
      } else {
        await page.locator('.option').first().click();
        await page.getByRole('button', { name: 'Devam' }).click();
      }
    });
  }
}

async function doNewWords(page: Page, shots: boolean) {
  let first = true;
  const reveal = page.getByRole('button', { name: 'Türkçesini göster' });
  for (;;) {
    await expect(reveal.or(page.locator('.match'))).toBeVisible();
    if (!(await reveal.isVisible())) break;
    if (shots && first) await shot(page, '03-picture-card');
    await page.getByRole('button', { name: 'Türkçesini göster' }).click();
    if (shots && first) await shot(page, '04-picture-card-meaning');
    first = false;
    await page.getByRole('button', { name: 'Devam' }).click();
  }
  // Drag-and-drop matching with pointer events.
  await expect(page.locator('.match')).toBeVisible();
  if (shots) await shot(page, '05-match');
  const chips = page.locator('[data-chip]:not([disabled])');
  while ((await chips.count()) > 0) {
    const chip = chips.first();
    const id = await chip.getAttribute('data-chip');
    const target = page.locator(`[data-target="${id}"]`);
    await target.scrollIntoViewIfNeeded();
    await chip.scrollIntoViewIfNeeded();
    const a = (await chip.boundingBox())!;
    const b = (await target.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(target).toHaveClass(/done/);
  }
}

async function doBlanks(page: Page) {
  for (let n = 1; n <= 3; n++) {
    await expect(page.getByText(`Boşluk doldurma ${n} / 3`)).toBeVisible();
    await step(page, '.blank', async () => {
      while (!(await page.locator('.blank .feedback').isVisible())) {
        await page.locator('.blank .option:not([disabled])').first().click();
      }
      await page.locator('.blank').getByRole('button', { name: 'Devam' }).click();
    });
  }
}

async function doReading(page: Page, shots: boolean) {
  await expect(page.locator('.reader')).toBeVisible();
  // Tap a word: picture + meaning, and it goes on the review list.
  const word = page.locator('.reader-text .w').filter({ hasText: /^(house|door|window|table|water|woman|man|tea|egg|bread|key|bag|car|street|chair|morning|home|coffee|phone|work)$/ }).first();
  await word.click();
  await expect(page.locator('.sheet')).toBeVisible();
  if (shots) await shot(page, '07-tap-word');
  await page.getByRole('button', { name: 'Kapat' }).click();
  await page.locator('.tr-toggle').first().click();
  if (shots) await shot(page, '06-reading');
  await page.getByRole('button', { name: 'Okudum, devam' }).click();
  if (shots) await shot(page, '08-fill-blank');
  await doBlanks(page);
  const offer = page.getByRole('heading', { name: 'Bir metin daha?' });
  await expect(offer.or(page.locator('.seg-title h1', { hasText: 'Mini sınav' }))).toBeVisible();
  if (await offer.isVisible()) {
    await page.getByRole('button', { name: 'Oku' }).click();
    await page.getByRole('button', { name: 'Okudum, devam' }).click();
    await doBlanks(page);
  }
}

async function doQuiz(page: Page, shots: boolean) {
  let first = true;
  while ((await segment(page)) === 'Mini sınav') {
    if (shots && first) await shot(page, '09-quiz');
    first = false;
    await step(page, '.choice', async () => {
      await page.locator('.option').first().click();
      await page.getByRole('button', { name: 'Devam' }).click();
    });
  }
}

async function completeLesson(page: Page, shots = false) {
  await page.getByRole('button', { name: /^(Başla|Devam et|Tekrar et)$/ }).click();
  await expect(page.locator('.seg-title h1')).toBeVisible();
  for (let guard = 0; guard < 8; guard++) {
    const seg = await segment(page);
    if (seg === 'Tekrar') await doReview(page);
    else if (seg === 'Yeni kelimeler') await doNewWords(page, shots);
    else if (seg === 'Okuma ve dinleme') await doReading(page, shots);
    else if (seg === 'Mini sınav') await doQuiz(page, shots);
    else if (seg === 'Özet') {
      if (shots) await shot(page, '10-summary');
      await page.getByRole('button', { name: 'Bitir' }).click();
      break;
    }
    await expect(page.locator('.seg-title h1')).not.toHaveText(seg);
  }
  await expect(page.getByRole('heading', { name: 'Bugün' })).toBeVisible();
}

test('four daily lessons from start to finish; all 20 words enter the review queue', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.clock.setFixedTime(day(1));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bugün' })).toBeVisible();
  await expect(page.getByText('Günün dersi')).toBeVisible();
  await expect(page.getByText('5 yeni kelime')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Başla' })).toBeVisible();
  // Single main action on the Today screen.
  await expect(page.locator('.btn-primary')).toHaveCount(1);
  await shot(page, '01-today');

  await completeLesson(page, true);
  await expect(page.getByText('Bugünkü ders tamam')).toBeVisible();
  await shot(page, '11-today-done');
  await expect(page.locator('.stat').nth(1)).toContainText('1');

  // Days 2–4: reviews + 5 new words each.
  for (const d of [2, 3, 4]) {
    await page.clock.setFixedTime(day(d));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Bugün' })).toBeVisible();
    const card = page.locator('.lesson-card');
    await expect(card, `day ${d}: ${await card.textContent()}`).toContainText('kelime tekrarı');
    if (d === 2) await shot(page, '12-today-day2');
    await completeLesson(page, false);
  }

  const stats = page.locator('.stat .num');
  await expect(stats.nth(1)).toHaveText('4'); // 4-day streak
  await expect(stats.nth(2)).toHaveText('20'); // all unit words introduced

  // Day 5: every word is in the spaced-repetition queue; no new words left.
  await page.clock.setFixedTime(day(6));
  await page.reload();
  const due = Number(await stats.nth(0).textContent());
  expect(due).toBeGreaterThan(0);
  await expect(page.getByText('yeni kelime', { exact: false })).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('settings, notifications and media review render', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Ayarlar' })).toBeVisible();
  await page.getByRole('radio', { name: '20 dk' }).click();
  await expect(page.getByRole('radio', { name: '20 dk' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Günlük ders hatırlatması')).toBeVisible();
  await expect(page.getByText('Sessiz saatler')).toBeVisible();
  await shot(page, '13-settings');
  await page.goto('/');
  await expect(page.getByText('Yaklaşık 20 dakika')).toBeVisible();

  await page.goto('/admin/review');
  await expect(page.getByRole('heading', { name: 'Medya inceleme' })).toBeVisible();
  await expect(page.locator('.review-card')).toHaveCount(20);
  await page.locator('.review-card').first().getByRole('button', { name: 'Yeniden üret' }).click();
  await expect(page.locator('textarea')).toContainText('"regenerate"');
  await shot(page, '14-admin-review');
});

test('works offline after the first visit (app shell + lesson media cached)', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bugün' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect(page.getByText('Sonraki ders çevrimdışı hazır')).toBeVisible({ timeout: 15_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bugün' })).toBeVisible();
  await expect(page.getByText(/^Çevrimdışı/)).toBeVisible();
  // the next lesson's pictures come from the cache
  const loaded = await page.locator('.preview img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
  expect(loaded).toBe(true);
  await context.setOffline(false);
});
