/**
 * browser_inject_script 的 CSP 兜底辅助函数测试。
 *
 * 运行：node test/inject-script.test.mjs
 */
import {
  buildCdpExpression,
  cdpErrorFromException,
  isCspEvalError,
} from '../src/tools/inject-script.js';

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('CSP 错误识别');
const cspError = new Error(
  "Evaluating a string as JavaScript violates the following Content Security Policy " +
    "directive because 'unsafe-eval' is not an allowed source of script: script-src 'self'.",
);
cspError.name = 'EvalError';
check('识别 EvalError + CSP', isCspEvalError(cspError));
check(
  '识别只有 CSP 文案的错误',
  isCspEvalError(new Error("Content Security Policy: 'unsafe-eval' is not allowed")),
);
check('普通页面错误不触发兜底', !isCspEvalError(new TypeError('x is not a function')));
check('空值不触发兜底', !isCspEvalError(null));

console.log('\nCDP 表达式');
const expression = buildCdpExpression('return args.x * 2;', { x: 21 });
check('保留 args 形参', expression.includes('async function(args)'));
check('使用 strict mode', expression.includes("'use strict'"));
check('把参数序列化进调用', expression.includes('{"x":21}'));
const value = await new Function(`return ${expression}`)();
check('表达式可执行并返回结果', value === 42, String(value));

console.log('\nCDP 异常转换');
const converted = cdpErrorFromException({
  exception: {
    className: 'TypeError',
    description: 'TypeError: boom\n    at <anonymous>:1:1',
  },
});
check('保留错误名', converted.name === 'TypeError', converted.name);
check('保留错误消息', converted.message === 'boom', converted.message);
check('保留堆栈', converted.stack.includes('at <anonymous>'), converted.stack);
check(
  '无异常对象时使用 text',
  cdpErrorFromException({ text: 'Uncaught' }).message === 'Uncaught',
);

if (failures > 0) {
  console.error(`\n${failures} 项 inject-script 测试失败。`);
  process.exit(1);
}
console.log('\ninject-script 测试通过。');
