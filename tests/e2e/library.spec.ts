import { expect, test } from '@playwright/test'

test('renders EchoShelf library', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'EchoShelf' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tu biblioteca' })).toBeVisible()
})
