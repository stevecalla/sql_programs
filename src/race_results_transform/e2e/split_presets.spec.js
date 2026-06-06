// Tier 2: the split-by-column group-name presets — type a group name, Save preset
// (status confirms), then Clear entries resets the boxes.
const { test, expect } = require('@playwright/test');
const { step, highlight, highlight_click, reset_steps, SINGLE_XLSX } = require('./helpers');

test.describe('race_results_transform — split presets', () => {
  test('save a grouping preset, then clear the entries', async ({ page }) => {
    reset_steps();
    await page.goto('/');
    await step(page, 'Opened the app');
    await page.setInputFiles('#fileInput', SINGLE_XLSX);
    await expect(page.locator('#compareCard')).toBeVisible();
    await highlight_click(page, page.locator('#compareSeg button[data-view="mapping"]'), 'Opening the Mapping tab');

    const panel = page.locator('.rrt-split');
    await expect(panel).toBeVisible();
    // Original basis = manual group-name mode (presets toolbar shows here)
    const original = panel.locator('[data-basis="original"]');
    if (await original.count()) await highlight_click(page, original.first(), 'Choosing the Original-value basis');

    const box = panel.locator('.m-grp').first();
    await expect(box).toBeVisible();
    await highlight(page, box);
    await step(page, 'Typing a group name into the first value box');
    await box.fill('My Group');

    await highlight_click(page, panel.locator('[data-save-preset]'), 'Clicking “Save preset”');
    await step(page, 'Status should confirm the preset saved');
    await expect(panel.locator('.split-preset-status')).toContainText('preset saved');

    await highlight_click(page, panel.locator('[data-clear-entries]'), 'Clicking “Clear entries”');
    await step(page, 'The group box should reset to empty');
    await expect(panel.locator('.m-grp').first()).toHaveValue('');
  });
});
