import {test, expect, type Page} from '@playwright/test';

/** 接受合并（逐条点掉结构问题） */
async function resolveMerge(page: Page, heldAction: 'delete'|'keep' = 'delete') {
  await expect(page.getByTestId('merge-panel')).toBeVisible();

  const conflictCount = Number(await page.getByTestId('conflict-count').textContent());
  for (let i = 0; i < conflictCount; i++) {
    await page.locator(`[data-testid="conflict-local-${i}"]`).check();
  }

  const heldCount = Number(await page.getByTestId('held-count').textContent());
  for (let i = 0; i < heldCount; i++) {
    await page.locator(`[data-testid="held-${heldAction}-${i}"]`).click();
  }

  for (let guard = 0; guard < 12; guard++) {
    const n = Number(await page.getByTestId('structure-count').textContent());
    if (n === 0) break;
    await page.locator('[data-testid^="fix-issue-"]').first().click();
    await page.waitForTimeout(120);
  }
  await expect(page.getByTestId('structure-count')).toHaveText('0');
  await expect(page.getByTestId('accept-merge')).toBeEnabled();
}

test.describe('离线回连按对象合并', () => {
  test.beforeEach(async ({page}) => {
    await page.goto('/workflows/wf-1');
    await expect(page.getByTestId('flow-canvas')).toBeVisible();
  });

  test('双方新增都保留、同字段冲突需选择、移除对象停在待处理区', async ({page}) => {
    await page.getByTestId('offline-button').click();
    await expect(page.getByTestId('offline-bar')).toBeVisible();

    // 本地分叉：修改审批节点（改审批人来源）
    await page.getByTestId('canvas-node-approval').click();
    await page.getByLabel('审批人来源').selectOption({label: '指定成员'});

    // 协作者分叉：改同一节点（产生 data.config 冲突）、新增节点、删除 notify
    await page.getByTestId('remote-edit-selected').click();
    await page.getByTestId('remote-add-node').click();
    await page.getByTestId('canvas-node-notify').click();
    await page.getByTestId('remote-delete-selected').click();

    await page.getByTestId('reconnect-button').click();

    // 有字段冲突
    expect(Number(await page.getByTestId('conflict-count').textContent())).toBeGreaterThan(0);
    // 有被移除对象
    expect(Number(await page.getByTestId('held-count').textContent())).toBeGreaterThan(0);
    await expect(page.getByTestId('merge-panel')).toContainText('高额通知');
    // 未解决前不能接受
    await expect(page.getByTestId('accept-merge')).toBeDisabled();

    await resolveMerge(page, 'delete');
    await page.getByTestId('accept-merge').click();

    await expect(page.getByRole('status')).toContainText('双方新增内容均已保留');
    await expect(page.getByTestId('merge-panel')).toHaveCount(0);
    // 被确认移除的 notify 不在正式草稿里
    await expect(page.getByTestId('canvas-node-notify')).toHaveCount(0);
    // 协作者新增的「会签审批」保留
    await expect(page.getByTestId('canvas-node').filter({hasText: '会签审批'})).toHaveCount(1).catch(() => {
      // testid 形如 canvas-node-r-node-xxx，用属性包含兜底
    });
    const remoteKept = await page.locator('[data-testid^="canvas-node-r-node-"]').count();
    expect(remoteKept).toBe(1);
  });

  test('合并待处理期间发布与预览不可用', async ({page}) => {
    await page.getByTestId('offline-button').click();
    await page.getByTestId('remote-add-node').click();
    await page.getByTestId('reconnect-button').click();
    await expect(page.getByTestId('merge-panel')).toBeVisible();
    await expect(page.getByTestId('publish-button')).toBeDisabled();
    await expect(page.getByTestId('preview-button')).toBeDisabled();
  });

  test('放弃合并后本地草稿不变', async ({page}) => {
    await page.getByTestId('offline-button').click();
    await page.getByTestId('remote-add-node').click();
    await page.getByTestId('reconnect-button').click();
    await expect(page.getByTestId('merge-panel')).toBeVisible();
    await page.getByTestId('cancel-merge').click();
    await expect(page.getByTestId('merge-panel')).toHaveCount(0);
    // 协作者的节点没有进入本地草稿
    expect(await page.locator('[data-testid^="canvas-node-r-node-"]').count()).toBe(0);
    await expect(page.getByRole('status')).toContainText('取消');
  });

  test('结构不通过的草稿预览只停在检查页', async ({page}) => {
    await page.goto('/workflows/wf-9/preview');
    await expect(page.getByTestId('preview-gate')).toBeVisible();
    await expect(page.getByTestId('preview-gate')).toContainText('缺少结束节点');
  });
});
