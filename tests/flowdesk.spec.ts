import {test,expect} from '@playwright/test';
test.describe.serial('FlowDesk 完整链路',()=>{
 test('Dashboard KPI 与最近流程进入编辑器',async({page})=>{await page.goto('/');await expect(page.getByTestId('kpi-grid')).toBeVisible();await expect(page.getByText('流程总数')).toBeVisible();await expect(page.getByText('异常实例',{exact:true}).first()).toBeVisible();await page.getByTestId('recent-workflow').first().click();await expect(page.getByTestId('flow-canvas')).toBeVisible();});
 test('审批配置、保存和双区域校验',async({page})=>{await page.goto('/workflows/wf-1');await page.getByTestId('canvas-node-approval').click();await expect(page.getByTestId('config-panel')).toContainText('审批配置');await page.getByLabel('审批人来源').selectOption({label:'固定角色'});await page.getByTestId('save-node-config').click();await page.getByRole('button',{name:'保存草稿'}).click();await page.getByTestId('validate-button').click();await expect(page.getByTestId('canvas-node-condition')).toHaveClass(/invalid/);await expect(page.getByTestId('issues-panel')).toContainText('条件分支规则未配置');const before=await page.getByTestId('error-count').textContent();expect(Number(before?.match(/\d+/)?.[0])).toBeGreaterThan(0);await page.getByTestId('canvas-node-condition').click();await page.getByLabel('条件字段').selectOption('amount');await page.getByLabel('条件比较值').fill('5000');await page.getByTestId('save-node-config').click();await page.getByTestId('validate-button').click();await expect(page.getByTestId('error-count')).toContainText('0 错误');});
 test('表单预览金额驱动条件分支',async({page})=>{await page.goto('/workflows/wf-1/preview');await expect(page.getByTestId('branch-result')).toContainText('标准分支');await page.getByLabel('申请金额').fill('12000');await expect(page.getByTestId('branch-result')).toContainText('高额分支');});
 test('发布后列表和总览同步',async({page})=>{await page.goto('/workflows/wf-2');await page.getByTestId('publish-button').click();await expect(page.getByRole('status')).toContainText('发布成功');await page.getByRole('link',{name:'流程管理'}).click();const row=page.getByTestId('workflow-row').filter({hasText:'采购合同审批'});await expect(row).toContainText('已发布');await expect(row).toContainText('v3');await page.getByRole('link',{name:'总览'}).click();await expect(page.getByTestId('kpi-grid')).toBeVisible();});
 test('异常实例详情、时间线与当前节点高亮',async({page})=>{await page.goto('/monitor');await page.getByRole('button',{name:'异常',exact:true}).click();await page.getByTestId('instance-row').first().click();await expect(page.getByTestId('instance-detail')).toBeVisible();await expect(page.getByTestId('execution-timeline')).toContainText('提交申请');await expect(page.locator('.runtime-highlight')).toHaveCount(1);});
 test('版本比较并恢复历史版本',async({page})=>{await page.goto('/workflows/wf-2/versions');await expect(page.getByTestId('version-compare')).toContainText('新增节点');await page.getByTestId('restore-version').click();await expect(page).toHaveURL(/\/workflows\/wf-2$/);await expect(page.getByRole('status')).toContainText('已恢复');await expect(page.getByTestId('flow-canvas')).toBeVisible();});
});

test('1440px 桌面视觉与控制台验证',async({page})=>{
 const errors:string[]=[]; page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 for(const path of ['/','/workflows/wf-1','/monitor']){await page.goto(path);await page.waitForTimeout(250);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);expect(overflow,`${path} 不应横向溢出`).toBeFalsy()}
 await page.goto('/'); await page.screenshot({path:'test-results/dashboard-1440.png',fullPage:true});
 expect(errors,'浏览器 console 不应出现 error').toEqual([]);
});

test.describe.serial('草稿合并与待处理区',()=>{
 test('离线合并：双方新增保留、字段冲突列出、移除停住待确认',async({page})=>{
  await page.goto('/workflows/wf-2');
  // 本地修改审批说明
  await page.getByTestId('canvas-node-approval').click();
  await page.getByLabel('审批说明').fill('请确认申请内容与预算归属（本地修订）');
  // 同事离线更改同一草稿后回连
  await page.getByTestId('simulate-peer').click();
  await expect(page.getByRole('status')).toContainText('陈默');
  await page.getByRole('button',{name:'保存草稿'}).click();
  // 合并结果进入待处理区
  await expect(page.getByTestId('pending-panel')).toBeVisible();
  // 对方新增的节点保留在画布上
  await expect(page.getByTestId('flow-canvas')).toContainText('超时提醒');
  // 同一字段双方改出不同值 → 冲突列出双方内容
  await expect(page.getByTestId('conflict-row')).toHaveCount(1);
  await expect(page.getByTestId('conflict-row')).toContainText('审批说明');
  await expect(page.getByTestId('conflict-row')).toContainText('本地修订');
  await expect(page.getByTestId('conflict-row')).toContainText('请先核对预算归属');
  // 被移除的对象先停住，不直接删除
  await expect(page.getByTestId('hold-row')).toHaveCount(5);
  const notifyHold=page.getByTestId('hold-row').filter({hasText:'高额通知'});
  await expect(notifyHold).toContainText('仍被 1 条连线引用');
  await expect(notifyHold.getByTestId('confirm-removal')).toBeDisabled();
  // 采用本地值解决字段冲突
  await page.getByTestId('resolve-local').click();
  await expect(page.getByTestId('conflict-row')).toHaveCount(0);
  // 确认移除自动化节点（其待确认连线一并移除）
  await page.getByTestId('hold-row').filter({hasText:'记录系统'}).getByTestId('confirm-removal').click();
  // 确认移除对方删掉的连线
  await page.getByTestId('hold-row').filter({hasText:'大于 5,000'}).getByTestId('confirm-removal').click();
  // 被引用的通知节点选择保留
  await notifyHold.getByTestId('keep-object').click();
  // 全部解决后自动固化为完整草稿
  await expect(page.getByRole('status')).toContainText('草稿已保存并通过检查');
  await expect(page.getByTestId('pending-panel')).toHaveCount(0);
  await expect(page.getByTestId('flow-canvas')).toContainText('超时提醒');
  await expect(page.getByTestId('flow-canvas')).toContainText('高额通知');
  await expect(page.getByTestId('flow-canvas')).not.toContainText('记录系统');
 });

 test('待处理合并阻止发布，预览只读取通过检查的草稿',async({page})=>{
  await page.goto('/workflows/wf-2');
  await page.getByTestId('canvas-node-approval').click();
  await page.getByLabel('审批说明').fill('本地未确认的修改');
  await page.getByTestId('simulate-peer').click();
  await page.getByRole('button',{name:'保存草稿'}).click();
  await expect(page.getByTestId('pending-panel')).toBeVisible();
  // 有待处理事项时不能发布
  await page.getByTestId('publish-button').click();
  await expect(page.getByRole('status')).toContainText('待处理');
  // 预览展示最近一次通过检查的草稿，而不是画布上的未确认内容
  await page.getByRole('button',{name:'预览'}).click();
  await expect(page.getByTestId('preview-stale-banner')).toBeVisible();
  await expect(page.getByTestId('preview-stale-banner')).toContainText('最近一次通过检查的草稿');
 });

 test('刷新后从最后完整草稿继续，未确认冲突不带入',async({page})=>{
  await page.goto('/workflows/wf-2');
  // 本地修改并保存：无远端更改，直接通过检查并固化
  await page.getByTestId('canvas-node-approval').click();
  await page.getByLabel('审批说明').fill('刷新前已确认的修改');
  await page.getByRole('button',{name:'保存草稿'}).click();
  await expect(page.getByRole('status')).toContainText('草稿已保存并通过检查');
  // 制造未确认的合并冲突
  await page.getByTestId('simulate-peer').click();
  await page.getByRole('button',{name:'保存草稿'}).click();
  await expect(page.getByTestId('pending-panel')).toBeVisible();
  // 刷新后从最后完整草稿继续，待处理区不带入下一步
  await page.reload();
  await expect(page.getByTestId('pending-panel')).toHaveCount(0);
  await page.getByTestId('canvas-node-approval').click();
  await expect(page.getByLabel('审批说明')).toHaveValue('刷新前已确认的修改');
 });

 test('两个标签页各自离线新增，回连合并后双方都保留',async({page,context})=>{
  const addNode=(pg:any,nodeId:string,label:string)=>pg.evaluate(([nodeId,label]:[string,string])=>{
   const st=(window as any).__appStore.getState();
   const w=st.workflows.find((x:any)=>x.id===st.currentId);
   st.updateNodes([...w.nodes,{id:nodeId,type:'notify',position:{x:640,y:430},data:{label,state:'valid',config:{targets:'财务审批人'}}}]);
   st.updateEdges([...w.edges,{id:'e-'+nodeId,source:'condition',target:nodeId}]);
  },[nodeId,label]);
  await page.goto('/workflows/wf-2');
  const page2=await context.newPage();
  await page2.goto('/workflows/wf-2');
  // 标签页 A 新增节点并保存
  await addNode(page,'tab-a-node','分支提醒A');
  await page.getByRole('button',{name:'保存草稿'}).click();
  await expect(page.getByRole('status')).toContainText('草稿已保存并通过检查');
  // 标签页 B 仍基于旧版本，新增节点保存时触发合并
  await addNode(page2,'tab-b-node','分支提醒B');
  await page2.getByRole('button',{name:'保存草稿'}).click();
  await expect(page2.getByRole('status')).toContainText('草稿已保存并通过检查');
  // 双方新增的节点和连线都保留，没有互相冲掉
  await expect(page2.getByTestId('canvas-node-tab-a-node')).toBeVisible();
  await expect(page2.getByTestId('canvas-node-tab-b-node')).toBeVisible();
  await expect(page2.getByTestId('pending-panel')).toHaveCount(0);
 });
});
