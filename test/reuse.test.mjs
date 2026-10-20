/**
 * 标签复用范围解析测试。
 *
 * 重点：站点范围必须从目标 URL 推导，不得依赖站点枚举。
 * 覆盖同站点 / 同源 / reuseKey，以及"新增站点无需改代码"。
 *
 * 运行：node test/reuse.test.mjs
 */
import {
  normalizeReuseHost,
  resolveReusePlan,
  reusePatternsFor,
  sortTabsByLastAccessed,
} from '../src/reuse.js';

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('默认行为');
{
  const plan = resolveReusePlan({ url: 'https://www.zhihu.com/search?q=ai' });
  check('默认按站点复用', plan.mode === 'site');
  check('默认不带 reuseKey', plan.key === undefined);

  const off = resolveReusePlan({ url: 'https://www.zhihu.com/', reuse: false });
  check('reuse=false 时新建标签', off.mode === null);
  check('reuse=false 时没有查询 pattern', off.patterns.length === 0);
}

console.log('\n同站点（site）');
{
  const plan = resolveReusePlan({ url: 'https://www.zhihu.com/search?type=content&q=ai' });
  check('覆盖 www 主机', plan.patterns.includes('*://www.zhihu.com/*'));
  check('同时覆盖裸域名', plan.patterns.includes('*://zhihu.com/*'));
  check('不跨子域（不出现通配子域）', !plan.patterns.some((p) => p.includes('*.')));

  const douyin = resolveReusePlan({ url: 'https://www.douyin.com/search/ai' });
  check('抖音不需要站点枚举', douyin.patterns.includes('*://douyin.com/*'));
  check('抖音 pattern 不含小红书', !douyin.patterns.some((p) => p.includes('xiaohongshu')));

  const weixin = resolveReusePlan({ url: 'https://mp.weixin.qq.com/', reuse: 'site' });
  check('公众号按自身主机复用', weixin.patterns.includes('*://mp.weixin.qq.com/*'));

  const bilibili = resolveReusePlan({ url: 'https://search.bilibili.com/all?keyword=ai' });
  check('B站搜索页保持独立', bilibili.patterns.includes('*://search.bilibili.com/*'));
  check('B站搜索页不会复用发布页', !bilibili.patterns.includes('*://member.bilibili.com/*'));

  const google = resolveReusePlan({ url: 'https://www.google.com/search?q=ai' });
  check('Google 同样零枚举', google.patterns.includes('*://google.com/*'));
}

console.log('\n同源（origin）');
{
  const plan = resolveReusePlan({ url: 'https://creator.xiaohongshu.com/publish', reuse: 'origin' });
  check('origin 精确到主机', plan.patterns.length === 1);
  check('origin pattern 正确', plan.patterns[0] === 'https://creator.xiaohongshu.com/*');

  const local = resolveReusePlan({ url: 'http://localhost:5173/app', reuse: 'origin' });
  check('origin 保留端口', local.patterns[0] === 'http://localhost:5173/*');

  const site = resolveReusePlan({ url: 'https://creator.xiaohongshu.com/publish', reuse: 'site' });
  check('site 模式不跨子域', !site.patterns.some((p) => p.includes('*://*.xiaohongshu.com/*')));
  check('site 模式锁定自身主机', site.patterns.includes('*://creator.xiaohongshu.com/*'));
}

console.log('\nreuseKey');
{
  const plan = resolveReusePlan({ url: 'https://www.zhihu.com/search?q=ai', reuseKey: ' zhihu-search ' });
  check('key 优先于站点推导', plan.mode === 'key' && plan.key === 'zhihu-search');
  check('key 模式不做站点兜底（首次出现必须新建标签）', plan.patterns.length === 0);

  const ignored = resolveReusePlan({ url: 'https://www.zhihu.com/', reuse: false, reuseKey: 'zhihu-search' });
  check('reuse=false 时 key 不生效', ignored.mode === null);

  const blank = resolveReusePlan({ url: 'https://www.zhihu.com/', reuseKey: '   ' });
  check('空白 key 视为未提供', blank.mode === 'site' && blank.key === undefined);
}

console.log('\n边界');
{
  check('无法解析的 URL 不复用', reusePatternsFor('not a url').length === 0);
  check('about:blank 不复用', reusePatternsFor('about:blank').length === 0);
  check('chrome:// 不复用', reusePatternsFor('chrome://extensions').length === 0);

  const bad = resolveReusePlan({ url: 'https://a.com/', reuse: 'tab' });
  check('非法 reuse 返回错误', typeof bad.error === 'string' && /reuse/.test(bad.error));

  const ignoredScope = resolveReusePlan({
    url: 'https://www.douyin.com/search/ai',
    reuseScope: 'xhs_web',
  });
  check('不再有旧 reuseScope 语义', ignoredScope.mode === 'site' && ignoredScope.patterns.includes('*://douyin.com/*'));

  const nullish = resolveReusePlan({ url: 'https://www.zhihu.com/', reuse: null });
  check('reuse=null 按默认处理', nullish.mode === 'site');

  check('www 前缀归一', normalizeReuseHost('WWW.Zhihu.com') === 'zhihu.com');
  check('m 前缀归一', normalizeReuseHost('m.zhihu.com') === 'zhihu.com');
  check('多级子域保留', normalizeReuseHost('mp.weixin.qq.com') === 'mp.weixin.qq.com');
  check('不会误删 www 开头的单词域名', normalizeReuseHost('wwwevil.com') === 'wwwevil.com');
}

console.log('\n候选标签排序');
{
  const tabs = [
    { id: 1, lastAccessed: 100 },
    { id: 2, lastAccessed: 300 },
    { id: 3, lastAccessed: 200 },
  ];
  check('取最近访问', sortTabsByLastAccessed(tabs)[0].id === 2);
  check('不改动入参顺序', tabs[0].id === 1);
  check('忽略没有 id 的条目', sortTabsByLastAccessed([{ lastAccessed: 999 }, { id: 7 }])[0].id === 7);
  check('空列表返回空数组', sortTabsByLastAccessed([]).length === 0);
  check('排序结果稳定', sortTabsByLastAccessed(tabs).map((t) => t.id).join(',') === '2,3,1');
}

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log('\n标签复用解析全部通过。');
process.exit(0);
