/**
 * 导航提交等待测试。
 *
 * 复用标签时 `tabs.update()` 在导航提交前就返回，旧文档仍是 complete /
 * readyState=complete。必须等 `webNavigation.onCommitted` 的主框架提交，
 * 才能继续等加载，否则会返回旧页面数据。
 *
 * 运行：node test/navigate.test.mjs
 */
function makeEvent() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    emit: (...args) => [...listeners].forEach((fn) => fn(...args)),
    count: () => listeners.size,
  };
}

const onCommitted = makeEvent();
const onRemoved = makeEvent();

globalThis.chrome = {
  webNavigation: { onCommitted },
  tabs: { onRemoved },
};

const { waitForNavigationCommit } = await import('../src/tabs.js');

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const pending = (promise) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('pending'), 60))]);

console.log('主框架提交');
{
  const promise = waitForNavigationCommit(101, 1000);
  onCommitted.emit({ tabId: 101, frameId: 1 });
  check('子框架提交不算完成', (await pending(promise)) === 'pending');

  onCommitted.emit({ tabId: 999, frameId: 0 });
  check('其他标签的提交不算完成', (await pending(promise)) === 'pending');

  onCommitted.emit({ tabId: 101, frameId: 0 });
  check('主框架提交后完成', (await promise) === true);
  check('完成后移除 onCommitted 监听', onCommitted.count() === 0);
  check('完成后移除 onRemoved 监听', onRemoved.count() === 0);
}

console.log('\n异常收敛');
{
  const timedOut = await waitForNavigationCommit(102, 40);
  check('超时返回 false', timedOut === false);
  check('超时后清理监听', onCommitted.count() === 0 && onRemoved.count() === 0);

  const removed = waitForNavigationCommit(103, 1000);
  onRemoved.emit(103);
  check('标签被关闭返回 false', (await removed) === false);
  check('标签关闭后清理监听', onCommitted.count() === 0 && onRemoved.count() === 0);
}

console.log('\n连续导航');
{
  const first = waitForNavigationCommit(104, 1000);
  onCommitted.emit({ tabId: 104, frameId: 0 });
  await first;

  const second = waitForNavigationCommit(104, 1000);
  onCommitted.emit({ tabId: 104, frameId: 0 });
  check('同一标签第二次复用仍能等到提交', (await second) === true);
}

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log('\n导航提交等待全部通过。');
process.exit(0);
