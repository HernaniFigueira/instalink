import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('Drawer traps keyboard, makes background inert, preserves edits, returns focus and scroll', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Abrir ficha', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Ficha sintética', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading')).toBeFocused();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await page.getByRole('button', { name: 'Fundo 0' }).evaluate((el: HTMLButtonElement) => el.focus());
  await expect(dialog.getByRole('heading')).toBeFocused(); // background really inert (not a mock)
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Fechar', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Fechar ficha' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Fechar', exact: true })).toBeFocused();
  await dialog.getByRole('textbox', { name: 'Nome na ficha' }).fill('Nome preservado');
  await dialog.getByRole('textbox', { name: 'Consome Escape' }).focus();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Nome na ficha' }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  await expect(page.getByRole('textbox', { name: 'Cliente', exact: true })).toHaveValue('Nome preservado');
});

test('nested Drawers close only the top layer and restore focus/scroll in order', async ({ page }) => {
  await page.getByRole('button', { name: 'Abrir ficha', exact: true }).click();
  const parent = page.getByRole('dialog', { name: 'Ficha sintética', exact: true });
  await parent.getByRole('button', { name: 'Abrir segunda ficha' }).click();
  const nested = page.getByRole('dialog', { name: 'Segunda ficha', exact: true });
  await expect(nested.getByRole('heading')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(nested).toHaveCount(0);
  await expect(parent).toBeVisible();
  await expect(parent.getByRole('button', { name: 'Abrir segunda ficha' })).toBeFocused();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await page.keyboard.press('Escape');
  await expect(parent).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Abrir ficha', exact: true })).toBeFocused();
});

test('Tabs use one tab stop, skip disabled and link real panels', async ({ page }) => {
  const agenda = page.getByRole('tab', { name: 'Agenda' });
  await agenda.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Fila' })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Fila' })).toBeVisible();
  await page.keyboard.press('Home'); await expect(agenda).toBeFocused();
  await page.keyboard.press('End'); await expect(page.getByRole('tab', { name: 'Fila' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Abrir ficha', exact: true })).toBeFocused();
});

test('platform colors/decorations do not leak into unscoped or clinic themes', async ({ page }) => {
  const legacy = page.getByTestId('legacy').getByRole('button', { name: 'Alternar escopo' });
  const clinic = page.getByTestId('public').getByRole('button');
  const before = await Promise.all([legacy, clinic].map(l => l.evaluate(el => {
    const s = getComputedStyle(el); return { bg: s.backgroundColor, fg: s.color, shadow: s.boxShadow };
  })));
  const colors = await page.getByRole('navigation', { name: 'Menu sintético' }).locator('a').evaluateAll(els => els.map(el => {
    const s = getComputedStyle(el); return `${s.backgroundColor}/${s.color}`;
  }));
  expect(new Set(colors).size).toBe(1);
  await expect(page.locator('.il-page-header__icon')).toHaveCSS('background-image', 'none');
  await legacy.click();
  await expect(page.locator('.il-page-header__icon')).not.toHaveCSS('background-image', 'none');
  await page.mouse.move(0, 0);
  await expect(legacy).toHaveCSS('background-color', before[0].bg);
  const after = await Promise.all([legacy, clinic].map(l => l.evaluate(el => {
    const s = getComputedStyle(el); return { bg: s.backgroundColor, fg: s.color, shadow: s.boxShadow };
  })));
  expect(after).toEqual(before);
});

test('visible focus and reduced-motion follow the scope, including root scrolling', async ({ page }) => {
  const tab = page.getByRole('tab', { name: 'Agenda' });
  await tab.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Fila' })).toHaveCSS('outline-style', 'solid');
  await expect(page.getByRole('tab', { name: 'Fila' })).toHaveCSS('outline-width', '2px');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.il-platform .animate-pulse')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto');
  await expect(tab).toHaveCSS('transition-duration', '0s');
  await page.getByRole('button', { name: 'Alternar escopo' }).click();
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'smooth');
});

for (const width of [390, 1366]) {
  test(`layout ${width}px: fields, touch targets, dialog bounds and screenshot`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    const icon = await page.getByRole('button', { name: 'Adicionar' }).boundingBox();
    expect(icon!.height).toBeGreaterThanOrEqual(width === 390 ? 44 : 36);
    expect(icon!.width).toBeGreaterThanOrEqual(width === 390 ? 44 : 36);
    await page.getByRole('button', { name: 'Abrir ficha', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Ficha sintética', exact: true });
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await expect(dialog.getByRole('textbox', { name: 'WhatsApp', exact: true })).toHaveValue('(21) 98765-4321');
    await page.screenshot({ path: testInfo.outputPath(`drawer-${width}.png`) });
    await page.keyboard.press('Escape');
    await page.screenshot({ path: testInfo.outputPath(`platform-${width}.png`), fullPage: true });
  });
}
