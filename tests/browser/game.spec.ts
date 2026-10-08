import { test, expect, type Page } from '@playwright/test';
async function create(page: Page) {
  await page.goto('/');
  await page.getByLabel('你的称呼').fill('阿青');
  await page.getByRole('button', { name: '创建团桌', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: '正在发生的事' })).toBeVisible();
}
async function mobileTab(page: Page, name: string) {
  const nav = page.locator('.mobile-nav');
  if (await nav.isVisible()) await nav.getByRole('button', { name, exact: true }).click();
}
async function character(page: Page, name = '沈禾') {
  await mobileTab(page, '角色');
  await page.getByRole('button', { name: '创建角色', exact: true }).click();
  await page.getByLabel('姓名', { exact: true }).fill(name);
  await page.getByLabel('最初的想法').fill('港口潜水维修工，带自己的工具寻找同伴。');
  await page.getByRole('button', { name: '创建并继续讨论' }).click();
  await mobileTab(page, '团录');
  await page.getByRole('button', { name: '与主持人讨论', exact: true }).click();
  await expect(page.locator('.entry').last()).toContainText('档案已经整理好');
  await mobileTab(page, '角色');
  await page.getByRole('button', { name: '采用这份角色档案' }).click();
  await expect(page.getByText('已入场', { exact: true })).toBeVisible();
}
test('建角、行动修改与撤回、裁决、物品地图、刷新恢复', async ({ page }, info) => {
  await create(page);
  await page.screenshot({ path: `test-results/${info.project.name}-welcome.png`, fullPage: true });
  await character(page);
  await page.getByRole('button', { name: /物品/ }).click();
  await expect(page.locator('.inventory').getByText('维修工具卷', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /已知地图/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: '零号井' })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await mobileTab(page, '团录');
  const room = (await page.locator('.room-tag').innerText()).trim();
  await page.route(`**/api/rooms/${room}`, (route) => route.abort(), { times: 1 });
  await page.getByLabel('你的行动').fill('我查看脚印。');
  await page.getByRole('button', { name: '加入行动板' }).click();
  await expect(page.getByLabel('你的行动')).toHaveValue('');
  await expect(page.getByRole('alert')).toContainText('请求已保存');
  await page.getByRole('button', { name: '关闭错误' }).click();
  await mobileTab(page, '行动板');
  await page.getByRole('button', { name: '修改', exact: true }).click();
  await page.getByLabel('你的行动').fill('我先观察脚印，再询问机械师。');
  await page.getByRole('button', { name: '加入行动板' }).click();
  await mobileTab(page, '行动板');
  await page.getByRole('button', { name: '撤回', exact: true }).click();
  await expect(page.locator('.intent')).toHaveCount(0);
  await mobileTab(page, '团录');
  await page.getByLabel('你的行动').fill('我观察脚印的方向。');
  await page.getByRole('button', { name: '加入行动板' }).click();
  await mobileTab(page, '行动板');
  await page.getByRole('button', { name: '发起本轮裁决' }).click();
  await mobileTab(page, '团录');
  await expect(page.locator('.entry').last()).toContainText('铁门没有上锁');
  await page.locator('.entry').last().locator('summary').click();
  await expect(page.locator('.roll')).toContainText('13');
  await page.reload();
  await expect(page.locator('.entry').last()).toContainText('铁门没有上锁');
  await page.screenshot({ path: `test-results/${info.project.name}-table.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('同一玩家创建第二角色后选中正确角色；同伴看不到私密行动', async ({ page, browser }) => {
  await create(page);
  await character(page);
  await character(page, '顾川');
  await mobileTab(page, '角色');
  await expect(page.getByLabel('当前角色')).toContainText('顾川');
  await expect(page.locator('.character-identity h2')).toHaveText('顾川');
  const code = (await page.locator('.room-tag').innerText()).trim();
  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto('http://127.0.0.1:4329');
  await guest.getByRole('button', { name: '加入朋友' }).click();
  await guest.getByLabel('你的称呼').fill('小林');
  await guest.getByLabel('六位团桌码').fill(code);
  await guest.getByRole('button', { name: '进入团桌', exact: true }).click();
  await mobileTab(page, '团录');
  await page.getByLabel('你的行动').fill('PRIVATE-ACTION');
  await page.getByLabel('私密', { exact: true }).check();
  await page.getByRole('button', { name: '加入行动板' }).click();
  await expect(guest.locator('.intent')).toHaveCount(0);
  await expect(guest.locator('.entry')).toHaveCount(0);
  await page.getByLabel('私密', { exact: true }).uncheck();
  await page.getByLabel('你的行动').fill('公开观察出入口');
  await page.getByRole('button', { name: '加入行动板' }).click();
  await expect(guest.locator('.intent')).toContainText('公开观察出入口');
  await expect(guest.locator('.intent')).toHaveCount(1);
  await expect(guest.locator('.intent')).toContainText('顾川');
  await context.close();
});

test('同一玩家的两个角色可以分别回答新选择', async ({ page }) => {
  await create(page);
  await character(page);
  await character(page, '顾川');
  for (const who of ['沈禾', '顾川']) {
    await mobileTab(page, '角色');
    await page.getByLabel('当前角色').selectOption({ label: who });
    await mobileTab(page, '团录');
    await page.getByLabel('你的行动').fill('进入之前让我们分别决定');
    await page.getByRole('button', { name: '加入行动板' }).click();
  }
  await mobileTab(page, '行动板');
  await page.getByRole('button', { name: '发起本轮裁决' }).click();
  await mobileTab(page, '团录');
  await expect(page.getByRole('heading', { name: '主持人需要你的决定' })).toBeVisible();
  await page.getByLabel('沈禾的决定').fill('留在门外观察');
  await page.getByLabel('顾川的决定').fill('我进入查看');
  await page.getByRole('button', { name: '回复主持人' }).click();
  await expect(page.locator('.entry').last()).toContainText('沈禾：留在门外观察');
  await expect(page.locator('.entry').last()).toContainText('顾川：我进入查看');
});
