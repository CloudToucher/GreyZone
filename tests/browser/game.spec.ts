import { test, expect, type Page } from '@playwright/test';
const concept =
  '我叫沈沅，港口潜水员，寻找失踪搭档。带自修的呼吸器，不带枪、不背债，想要接触金属辨别振动的能力。想玩调查与救援。';
async function discuss(page: Page, text = concept) {
  await page.goto('/');
  await page.getByLabel('你的角色设想').fill(text);
  await page.getByRole('button', { name: '与主持人一起开局' }).click();
  await expect(page.getByRole('button', { name: '查看角色草案' })).toBeVisible();
}
async function start(page: Page) {
  await discuss(page);
  await page.getByRole('button', { name: '就以这个角色开始' }).click();
  await expect(
    page.getByRole('heading', { name: '集装箱码头', exact: true, level: 1 }),
  ).toBeVisible();
}
async function say(page: Page, text: string) {
  await page.locator('#intent').fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
}

test('desktop: free concept, negotiated sheet, character-specific opening and continued dialogue', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('select')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/free-entry-desktop.png', fullPage: true });
  await discuss(page);
  await expect(page.locator('.draft-sheet')).toContainText('水下切割');
  await expect(page.locator('.draft-sheet')).toContainText('欠款 0');
  await page.getByLabel('继续与主持人讨论').fill('把范围改为六米，基础能耗三点，其余保留');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.ability-detail')).toContainText('六米');
  await expect(page.locator('.ability-detail')).toContainText('能耗 3');
  await page.screenshot({ path: 'test-results/character-discussion-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '就以这个角色开始' }).click();
  await expect(page.locator('.journal')).toContainText('叶遥');
  await expect(page.locator('.character-column')).not.toBeVisible();
  await say(page, '场外：解释我的异能限制');
  await expect(
    page
      .locator('.journal')
      .getByText(
        '金属传振需要接触连续金属，范围以角色档案为准。水下切割是你的专业，无法代替没有工具的工作。',
      ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '确认行动' })).toHaveCount(0);
  await expect(page.locator('.world-time')).toContainText('06:00');
  await say(page, '向叶遥打招呼');
  await expect(page.locator('.world-time')).toContainText('06:01');
  await expect(page.getByRole('button', { name: '确认行动' })).toHaveCount(0);
  await say(page, '发动金属传振');
  await expect(page.getByRole('button', { name: '确认行动' })).toBeVisible();
  await expect(page.locator('.proposal')).toContainText('3 能量');
  await say(page, '为什么要这个代价？');
  await expect(page.getByRole('button', { name: '确认行动' })).toBeVisible();
  await page.getByRole('button', { name: '确认行动' }).click();
  await expect(page.locator('.roll').last()).toBeVisible();
  await say(page, '新增专长：船舶焊接');
  await expect(page.getByRole('button', { name: '采用这份修订' })).toBeVisible();
  await page.getByRole('button', { name: '采用这份修订' }).click();
  await page.getByRole('button', { name: '角色', exact: true }).click();
  await page.getByText('经历与同伴', { exact: true }).click();
  await expect(page.locator('.background')).toContainText('船舶焊接');
  await page.getByRole('button', { name: '现场', exact: true }).first().click();
  await page.screenshot({ path: 'test-results/conversation-play-desktop.png', fullPage: true });
  await page.reload();
  await expect(page.locator('.journal')).toContainText('角色档案修订');
});

test('mobile: discussion, draft and play remain reachable without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await discuss(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '查看角色草案' }).click();
  await expect(page.locator('.workshop-draft')).toBeVisible();
  await page.screenshot({ path: 'test-results/character-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '就以这个角色开始' }).click();
  await expect(
    page.getByRole('heading', { name: '集装箱码头', exact: true, level: 1 }),
  ).toBeVisible();
  await page.getByRole('button', { name: '角色', exact: true }).click();
  await expect(page.getByRole('heading', { name: '沈沅', exact: true })).toBeVisible();
  await page.getByText('自带水囊', { exact: true }).click();
  await expect(page.getByRole('button', { name: '使用一份' })).toBeVisible();
  await page.getByRole('button', { name: '区域', exact: true }).first().click();
  await page.getByRole('button', { name: '展开区域地图' }).click();
  await expect(page.getByRole('dialog', { name: '区域地图' })).toBeVisible();
  await page.getByRole('button', { name: '关闭区域地图' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('joining players negotiate their own character and retain action ownership', async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const host = await a.newPage(),
    guest = await b.newPage();
  try {
    await start(host);
    const cred = await host.evaluate(() =>
      JSON.parse(localStorage.getItem('greyzone.session.v2')!),
    );
    await guest.goto('/');
    await guest.getByRole('button', { name: '已有同伴？加入他们的战役' }).click();
    await guest.getByLabel('房间码').fill(cred.room);
    await guest.getByLabel('你的角色设想').fill('同伴，港务人员，有自己的金属感知');
    await guest.getByRole('button', { name: '和主持人商量入队角色' }).click();
    await expect(guest.getByRole('button', { name: '就以这个角色开始' })).toBeVisible();
    await expect(host.locator('.room-code')).toContainText('1/4');
    await guest.getByRole('button', { name: '就以这个角色开始' }).click();
    await expect(host.locator('.room-code')).toContainText('2/4');
    await say(guest, '发动金属传振');
    await expect(host.getByRole('heading', { name: '接触铁栏，分辨机械震动' })).toBeVisible();
    await expect(host.getByRole('button', { name: '确认行动' })).toHaveCount(0);
    await guest.getByRole('button', { name: '确认行动' }).click();
    await expect(guest.locator('.roll').last()).toBeVisible();
  } finally {
    await a.close();
    await b.close();
  }
});

test('lost workshop and commit responses reuse receipts after SSE updates', async ({ page }) => {
  await discuss(page);
  await page.route(
    '**/workshop',
    async (route) => {
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByLabel('继续与主持人讨论').fill('改为六米');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试未确认请求' })).toBeVisible();
  await page.getByRole('button', { name: '重试未确认请求' }).click();
  await expect(page.getByRole('button', { name: '重试未确认请求' })).toHaveCount(0);
  await expect(page.getByLabel('继续与主持人讨论')).toHaveValue('');
  await page.getByRole('button', { name: '就以这个角色开始' }).click();
  await say(page, '发动金属传振');
  await page.route(
    '**/decisions',
    async (route) => {
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: '确认行动' }).click();
  await expect(page.getByRole('button', { name: '重试未确认请求' })).toBeVisible();
  await page.getByRole('button', { name: '重试未确认请求' }).click();
  await expect(page.getByRole('button', { name: '重试未确认请求' })).toHaveCount(0);
  await page.getByRole('button', { name: '角色', exact: true }).click();
  await expect(page.locator('.power-card').first()).toContainText('6 / 9');
  await expect(page.locator('.roll')).toHaveCount(1);
});
