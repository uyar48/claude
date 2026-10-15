import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** Istanbul 19:00 on the given day of October 2026. */
const day = (d: number) => new Date(Date.UTC(2026, 9, 13 + d, 16, 0));

/** Clicks the result bar's "Devam" if it is (still) there. */
async function next(page: Page) {
  await page
    .locator('.ex .feedback .btn')
    .first()
    .click({ timeout: 2500 })
    .catch(() => {});
}

/** Answers the exercise on screen (not always correctly) and waits for the next one. */
async function answer(page: Page, seen: Set<string>, shots: boolean) {
  const ex = page.locator('.ex').first();
  await expect(ex).toBeVisible();
  const cls = (await ex.getAttribute('class')) ?? '';
  const kind = cls.replace('ex', '').trim() || 'match';
  const label = ((await page.locator('.ex-label').textContent()) ?? '').split('·').pop()!.trim();
  if (shots && !seen.has(label)) await shot(page, `ex-${seen.size}-${kind}`);
  seen.add(label);
  const handle = await ex.elementHandle();
  // Spend a realistic (fake) time on it: the lesson counts active minutes.
  const SECONDS: Record<string, number> = { intro: 25, 'choice-ex': 12, match: 45, dictation: 25, blank: 20, build: 35, reading: 240, scene: 70 };
  await page.clock.fastForward((SECONDS[kind] ?? 15) * 1000);

  if (kind === 'intro') {
    await ex.getByRole('button', { name: 'Devam' }).click();
  } else if (kind === 'choice-ex' || kind === 'blank') {
    while (!(await ex.locator('.feedback').isVisible())) {
      await ex.locator('.option:not([disabled])').first().click();
    }
    await next(page);
  } else if (kind === 'dictation') {
    await ex.getByRole('textbox').fill('xyz');
    await ex.getByRole('button', { name: 'Kontrol et' }).click();
    await ex.getByRole('button', { name: 'Bilmiyorum, göster' }).click();
    await next(page);
  } else if (kind === 'build') {
    const tiles = ex.locator('.tiles .tile:not([disabled])');
    while ((await tiles.count()) > 0) await tiles.first().click();
    await ex.getByRole('button', { name: 'Kontrol et' }).click();
    await next(page);
  } else if (kind === 'reading') {
    const word = ex.locator('.reader-text .w').first();
    await word.click();
    await expect(page.locator('.sheet')).toBeVisible();
    if (shots) await shot(page, 'ex-reading-tap');
    await page.getByRole('button', { name: 'Kapat' }).click();
    await ex.getByRole('button', { name: /Sorulara geç|Devam/ }).click();
    for (let q = 0; q < 6 && (await ex.isVisible()); q++) {
      const opt = ex.locator('.option:not([disabled])').first();
      if (!(await opt.isVisible().catch(() => false))) break;
      await opt.click();
      await next(page);
    }
  } else if (kind === 'scene') {
    const items = ex.locator('.scene-item:not(.found)');
    for (let guard = 0; guard < 60 && (await items.count()) > 0; guard++) {
      await items.nth(guard % (await items.count())).click();
      await page.waitForTimeout(500);
    }
    await next(page);
  } else if (kind === 'speed') {
    await ex.getByRole('button', { name: 'Başla' }).click();
    for (let i = 0; i < 5; i++) await ex.locator('.option').first().click();
    if (shots) await shot(page, 'ex-speed-running');
    await page.clock.fastForward(61_000);
    await next(page);
  } else {
    // Match: drag every word onto its picture / meaning with pointer events.
    const chips = ex.locator('[data-chip]:not([disabled])');
    while ((await chips.count()) > 0) {
      const chip = chips.first();
      const id = await chip.getAttribute('data-chip');
      const target = ex.locator(`[data-target="${id}"]`);
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
  if (handle) await handle.waitForElementState('hidden', { timeout: 15_000 });
}

/** Plays exercises until the finish screen. Returns the exercise kinds seen. */
async function playLesson(page: Page, shots = false): Promise<Set<string>> {
  const seen = new Set<string>();
  const finish = page.locator('.finish');
  for (let i = 0; i < 120; i++) {
    await expect(page.locator('.ex').or(finish)).toBeVisible();
    if (await finish.isVisible()) return seen;
    await answer(page, seen, shots);
  }
  throw new Error('lesson did not end');
}

test('lessons follow completion, not the calendar', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: day(1) });

  await page.goto('/settings');
  await page.getByRole('radio', { name: '20 dk' }).click();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bugün', exact: true })).toBeVisible();
  const card = page.locator('.lesson-card');
  await expect(card).toContainText('1. ders');
  await expect(card).toContainText('10 yeni kelime');
  await expect(card).toContainText('Yaklaşık 20 dakika');
  await expect(page.locator('.btn-primary')).toHaveCount(1);
  await shot(page, '01-today');

  await page.getByRole('button', { name: 'Başla' }).click();
  const seen = await playLesson(page, true);
  // At least 8 kinds of exercise besides the new-word cards.
  console.log('exercise types:', [...seen].join(', '));
  expect([...seen].filter((k) => k !== 'Yeni kelime').length).toBeGreaterThanOrEqual(8);
  await expect(page.locator('.finish')).toContainText('1. ders tamam');
  await expect(page.locator('.finish')).toContainText('günlük hedef tamam');
  await shot(page, '02-finish');

  // "Bir ders daha" opens the next lesson immediately, with new words.
  await page.getByRole('button', { name: 'Bir ders daha' }).click();
  await expect(page.locator('.ex-label')).toContainText('2. ders');
  await expect(page.locator('.ex.intro, .ex.choice-ex').first()).toBeVisible();
  await answer(page, new Set(), false);

  // Leave mid-lesson; come back days later: nothing is locked or skipped.
  await page.getByRole('button', { name: 'Dersi duraklat' }).click();
  await expect(card).toContainText('2. ders');
  await expect(page.getByRole('button', { name: 'Devam et' })).toBeVisible();
  await page.clock.setSystemTime(day(5));
  await page.reload();
  await expect(card).toContainText('2. ders');
  await expect(card).toContainText('Kaldığın yerden devam et');
  await shot(page, '03-today-after-break');
  await page.getByRole('button', { name: 'Devam et' }).click();
  await playLesson(page);
  await expect(page.locator('.finish')).toContainText('2. ders tamam');
  await page.getByRole('button', { name: 'Bugünlük bu kadar' }).click();

  await expect(page.getByRole('heading', { name: 'Bugün', exact: true })).toBeVisible();
  await expect(page.getByText('Günlük hedef tamam')).toBeVisible();
  await expect(card).toContainText('3. ders');
  const stats = page.locator('.stat .num');
  await expect(stats.nth(0)).toHaveText('2'); // two goal days, the gap does not reset the streak
  await expect(stats.nth(1)).toHaveText(/^(1[0-9]|2[0-9])$/);
  await expect(page.locator('.freeze')).toBeVisible();
  await shot(page, '04-today-goal-done');

  expect(errors).toEqual([]);
});

test('settings: goal, new words per lesson, break; sources and picture review', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Ayarlar' })).toBeVisible();
  await page.getByRole('radio', { name: '45 dk' }).click();
  await expect(page.getByRole('radio', { name: '45 dk' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Artır' }).click();
  await page.getByRole('button', { name: 'Artır' }).click();
  await expect(page.locator('.stepper strong')).toHaveText('12');
  await page.getByRole('checkbox', { name: /Ara verdim/ }).check();
  await expect(page.getByText('Günlük ders hatırlatması')).toBeVisible();
  await shot(page, '05-settings');

  await page.goto('/');
  await expect(page.locator('.pause-card')).toBeVisible();
  await expect(page.locator('.lesson-card')).toContainText('12 yeni kelime');
  await expect(page.locator('.lesson-card')).toContainText('Yaklaşık 45 dakika');
  await shot(page, '06-today-paused');
  await page.getByRole('button', { name: 'Aradan dön' }).click();
  await expect(page.locator('.pause-card')).toHaveCount(0);

  await page.goto('/settings/gorseller');
  await expect(page.getByRole('heading', { name: 'Görsel kaynakları' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Openverse' })).toBeVisible();
  await shot(page, '07-image-sources');

  await page.goto('/kaynaklar');
  await expect(page.getByRole('heading', { name: 'Tatoeba cümle sahipleri' })).toBeVisible();
  await expect(page.getByText('CC BY-SA 4.0')).toBeVisible();
  await shot(page, '08-credits');

  await page.goto('/admin/review');
  await expect(page.getByRole('heading', { name: 'Görsel seçimi' })).toBeVisible();
  await shot(page, '09-admin-review');
  // Pick another candidate for "house", say "no picture" for "door"; both survive a reload.
  const second = page.getByRole('button', { name: 'house: aday 2 seç' });
  const file = await second.locator('img').getAttribute('src');
  await second.click();
  await page.getByRole('button', { name: 'door: görsel yok' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'house: aday 2 seç' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'door: görsel yok' })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/');
  const house = page.locator('.preview .picture[data-word="house"] img');
  await expect(house).toHaveAttribute('src', file!);
  await expect(page.locator('.preview .picture[data-word="door"] img')).toHaveCount(0);
});

test('works offline after the first visit (app shell + lesson media cached)', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bugün', exact: true })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect(page.getByText('Sonraki ders çevrimdışı hazır')).toBeVisible({ timeout: 15_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bugün', exact: true })).toBeVisible();
  await expect(page.getByText(/^Çevrimdışı/)).toBeVisible();
  // The next lesson's pictures come from the cache.
  const imgs = page.locator('.preview img');
  if ((await imgs.count()) > 0) {
    const loaded = await imgs.first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
    expect(loaded).toBe(true);
  }
  await page.getByRole('button', { name: 'Başla' }).click();
  await expect(page.locator('.ex').first()).toBeVisible();
  await context.setOffline(false);
});
