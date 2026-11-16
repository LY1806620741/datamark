// 音视频标注台 · 端到端回归测试
// 覆盖：首屏、引导、文稿校对与导出、视频划框与打码像素、目录即时写入、只读预览包、JSON 往返
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const FIXTURE = path.join(__dirname, 'fixtures', 'demo.mp4');
const GUIDE_KEY = 'annotator.guide.v1';

async function openApp(page, { guide = false } = {}) {
  if (!guide) {
    await page.addInitScript(key => { try { localStorage.setItem(key, '1'); } catch (e) { } }, GUIDE_KEY);
  }
  await page.goto('/index.html');
  await expect(page.locator('#itemList .item')).toHaveCount(2);
  await expect(page.locator('#aList .seg')).toHaveCount(8);
}

async function attachFixture(page) {
  await page.locator('#itemList .item').nth(1).click();
  await page.setInputFiles('#fileAttach', FIXTURE);
  await expect(page.locator('#vCv')).toBeVisible();
  await page.waitForFunction(() => {
    const cv = document.getElementById('vCv');
    return cv && cv.width > 0 && document.getElementById('vEl').videoWidth > 0;
  });
  await page.waitForTimeout(300);
}

async function dragBox(page, ax, ay, bx, by) {
  const box = await page.locator('#vCv').boundingBox();
  await page.mouse.move(box.x + box.width * ax, box.y + box.height * ay);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * bx, box.y + box.height * by, { steps: 8 });
  await page.mouse.up();
}

async function installFakeDir(page) {
  await page.evaluate(() => {
    const store = {};
    window.__fakeStore = store;
    const mk = name => ({
      kind: 'file', name,
      async getFile() { const b = store[name]; return new Blob([b ? b.data : ''], { type: b ? b.type : '' }); },
      async createWritable() {
        return {
          write: async blob => {
            const txt = typeof blob === 'string' ? blob : await new Blob([blob]).text();
            store[name] = { data: txt, type: (blob && blob.type) || '' };
          },
          close: async () => { }
        };
      }
    });
    window.showDirectoryPicker = async () => ({
      kind: 'directory', name: 'fake-dir',
      async getFileHandle(name, opt) {
        if (!store[name] && !(opt && opt.create)) throw new DOMException('nf', 'NotFoundError');
        return mk(name);
      },
      async *entries() { for (const n of Object.keys(store)) yield [n, mk(n)]; }
    });
  });
}

test('首屏：示例项目可打开，无控制台报错', async ({ page }) => {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await openApp(page);
  await expect(page.locator('h1')).toHaveText('音视频标注台');
  await expect(page.locator('#storeBadge')).toContainText('已自动保存');
  await expect(page.locator('#itemList .item').nth(1)).toContainText('录屏');
  expect(errors).toEqual([]);
});

test('新手引导：首次访问三步走完，刷新后不再打断', async ({ page }) => {
  await openApp(page, { guide: true });
  const guide = page.locator('#guide');
  await expect(guide).toBeVisible();
  await expect(page.locator('#gStep')).toHaveText('STEP 1 / 3');
  await expect(page.locator('#gRing')).toBeVisible();
  await page.locator('#gNext').click();
  await expect(page.locator('#gTitle')).toContainText('标注');
  await page.locator('#gNext').click();
  await expect(page.locator('#gTitle')).toContainText('带走结果');
  await page.locator('#gNext').click();
  await expect(guide).toBeHidden();
  expect(await page.evaluate(k => localStorage.getItem(k), GUIDE_KEY)).toBe('1');
  await page.reload();
  await page.waitForTimeout(1400);
  await expect(guide).toBeHidden();
});

test('文稿校对：改原文、标重点、双语对照、SRT 导出', async ({ page }) => {
  await openApp(page);
  const first = page.locator('#aList .seg .txt').first();
  await first.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('校对后的第一段');
  await expect(first).toHaveText('校对后的第一段');

  await page.locator('#aList .seg .star').nth(1).click();
  await expect(page.locator('#aList .seg .star').nth(1)).toHaveClass(/on/);

  await page.locator('#aBi').check();
  await expect(page.locator('#aList .seg .tr').first()).toBeVisible();

  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.locator('#aExp').click();
      await page.locator('.menu button', { hasText: 'SRT 字幕（原文）' }).click();
    })()
  ]);
  const file = await dl.path();
  const srt = fs.readFileSync(file, 'utf8');
  expect(srt).toContain('-->');
  expect(srt).toContain('校对后的第一段');

  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForTimeout(600);
  await expect(page.locator('#aList .seg .txt').first()).toHaveText('校对后的第一段');
});

test('新增段落与搜索过滤', async ({ page }) => {
  await openApp(page);
  await page.locator('#aAddCur').click();
  await expect(page.locator('#aList .seg')).toHaveCount(9);

  const seg = page.locator('#aList .seg .txt').nth(1);
  await seg.click();
  await page.keyboard.type('唯一标记词甲乙丙');
  await page.locator('#aSearch').fill('甲乙丙');
  await page.waitForTimeout(250);
  await expect(page.locator('#aList .seg')).toHaveCount(1);
});

test('视频：挂素材、拖框划重点与打码、改起止时间', async ({ page }) => {
  await openApp(page);
  await attachFixture(page);

  await page.locator('#vTools button[data-tool="blur"]').click();
  await dragBox(page, 0.56, 0.68, 0.78, 0.82);
  await page.locator('#vTools button[data-tool="rect"]').click();
  await dragBox(page, 0.06, 0.5, 0.45, 0.62);
  await expect(page.locator('#rgList .rg')).toHaveCount(2);

  const kinds = await page.evaluate(() => window.__ANNOTATOR__.project.items.find(i => i.kind === 'video').regions.map(r => r.kind));
  expect(kinds.sort()).toEqual(['blur', 'rect']);

  const t0 = page.locator('#rgList .rg .t0').first();
  await t0.fill('00:00.5');
  await t0.press('Enter');
  await page.waitForTimeout(150);
  const r0 = await page.evaluate(() => window.__ANNOTATOR__.project.items.find(i => i.kind === 'video').regions[0]);
  expect(Math.abs(r0.t0 - 0.5)).toBeLessThan(0.2);
});

test('打码实际改写画面：像素变化集中在框内', async ({ page }) => {
  await openApp(page);
  await attachFixture(page);
  await page.locator('#vTools button[data-tool="blur"]').click();
  await dragBox(page, 0.55, 0.66, 0.8, 0.84);
  await page.waitForTimeout(200);

  await page.evaluate(() => { const v = document.getElementById('vEl'); v.currentTime = 1.0; });
  await page.waitForTimeout(600);

  const res = await page.evaluate(async () => {
    const cv = document.getElementById('vCv');
    const ctx = cv.getContext('2d');
    const show = document.getElementById('vShow');
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const grab = () => ctx.getImageData(0, 0, cv.width, cv.height).data;
    if (show.checked) { show.checked = false; show.dispatchEvent(new Event('change')); }
    await wait(150);
    const a = grab();
    show.checked = true; show.dispatchEvent(new Event('change'));
    await wait(150);
    const b = grab();
    let count = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        if (Math.abs(a[i] - b[i]) > 6 || Math.abs(a[i + 1] - b[i + 1]) > 6 || Math.abs(a[i + 2] - b[i + 2]) > 6) {
          count++;
          if (x < minX) minX = x; if (y < minY) minY = y;
          if (x > maxX) maxX = x; if (y > maxY) maxY = y;
        }
      }
    }
    const v = document.getElementById('vEl');
    const s = cv.width / v.videoWidth;
    const r = window.__ANNOTATOR__.project.items.find(i => i.kind === 'video').regions[0];
    return { count, box: [minX, minY, maxX, maxY], expect: [r.x * s, r.y * s, (r.x + r.w) * s, (r.y + r.h) * s] };
  });

  expect(res.count, '打码区域应产生像素变化').toBeGreaterThan(50);
  const [ex, ey, ew, eh] = res.expect;
  const [bx, by, bw, bh] = res.box;
  expect(bx).toBeLessThanOrEqual(ex + 6);
  expect(by).toBeLessThanOrEqual(ey + 6);
  expect(bw).toBeGreaterThanOrEqual(ew - 6);
  expect(bh).toBeGreaterThanOrEqual(eh - 6);
});

test('目录标注：即时写入单一数据文件，并生成 README', async ({ page }) => {
  await openApp(page);
  await installFakeDir(page);
  await page.locator('#btnOpenDir').click();
  await page.waitForTimeout(900);

  let files = await page.evaluate(() => Object.keys(window.__fakeStore).sort());
  expect(files).toEqual(['README.md', 'annotations.json']);
  await expect(page.locator('#storeBadge')).toContainText('已写入目录');

  await page.locator('#aList .seg .txt').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('（即时写入）');
  await page.waitForTimeout(2600);

  const out = await page.evaluate(() => {
    const s = window.__fakeStore['annotations.json'];
    const o = JSON.parse(s.data);
    return {
      items: o.items.length,
      text: o.items[0].segments[0].text,
      files: Object.keys(window.__fakeStore).length,
      readme: window.__fakeStore['README.md'].data
    };
  });
  expect(out.items).toBe(2);
  expect(out.text).toContain('（即时写入）');
  expect(out.files, '只应有一个数据文件').toBe(2);
  expect(out.readme).toContain('annotations.json');
});

test('只读预览包：离线打开、无编辑入口、可播放', async ({ page }) => {
  await openApp(page);
  await attachFixture(page);
  await page.locator('#vTools button[data-tool="blur"]').click();
  await dragBox(page, 0.55, 0.66, 0.8, 0.84);
  await page.waitForTimeout(200);

  const html = await page.evaluate(async () => (await window.__ANNOTATOR__.buildReadOnlyHTML()).html);
  expect(html).toContain('id="bundleData"');
  expect(html).toContain('window.__BUNDLE__=true');

  const file = path.join(os.tmpdir(), `annotator-bundle-${Date.now()}.html`);
  fs.writeFileSync(file, html, 'utf8');

  await page.goto('file://' + file);
  await expect(page.locator('#roBand')).toBeVisible();
  await expect(page.locator('#itemList .item')).toHaveCount(2);
  await expect(page.locator('#btnImportMedia')).toBeHidden();
  await expect(page.locator('#aAddCur')).toBeHidden();

  await expect(page.locator('#aList .seg .txt').first()).toHaveAttribute('contenteditable', 'false');
  await page.locator('#itemList .item').nth(1).click();
  await expect(page.locator('#rgList .rg')).toHaveCount(1);
  const dur = await page.evaluate(() => document.getElementById('vEl').duration);
  expect(dur).toBeGreaterThan(1);
  await expect(page.locator('#storeBadge')).toHaveText('只读');
  fs.unlinkSync(file);
});

test('项目 JSON 往返：导出再导入项目与名称保持一致', async ({ page }) => {
  await openApp(page);
  await page.fill('#projName', '往返项目');
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.locator('#btnExportAll').click();
      await page.locator('.menu button', { hasText: '项目 JSON' }).first().click();
    })()
  ]);
  const file = await dl.path();
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(data.items.length).toBe(2);
  expect(data.name).toBe('往返项目');

  page.once('dialog', d => d.accept());
  await page.setInputFiles('#fileJson', file);
  await page.waitForTimeout(600);
  await expect(page.locator('#itemList .item')).toHaveCount(2);
  await expect(page.locator('#projName')).toHaveValue('往返项目');
});
