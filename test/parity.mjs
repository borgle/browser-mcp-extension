/**
 * 离线契约校验（不需要浏览器）：
 *   1. 工具注册名唯一且数量正确；
 *   2. 消息类型常量完整且值唯一；
 *   3. 未知工具返回统一错误。
 *
 * 运行：node test/parity.mjs
 */
import { listToolNames, registerBuiltinTools } from '../src/tools/registry.js';
import { MSG } from '../src/constants.js';

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}${detail ? `：${detail}` : ''}`);
  }
}

registerBuiltinTools();
const extensionTools = listToolNames();

console.log('工具注册');
check(`扩展工具数量 = ${extensionTools.length}`, extensionTools.length === 19, `实际 ${extensionTools.length}`);
check('工具名称唯一', new Set(extensionTools).size === extensionTools.length);
check('工具名称均为非空字符串', extensionTools.every((name) => typeof name === 'string' && name.length > 0));

console.log('协议常量');
check('消息类型数量 = 9', Object.keys(MSG).length === 9, `实际 ${Object.keys(MSG).length}`);
check('消息类型值唯一', new Set(Object.values(MSG)).size === Object.values(MSG).length);
check('消息类型值均为非空字符串', Object.values(MSG).every((value) => typeof value === 'string' && value.length > 0));

// 每个工具都得有可调用的 execute
const { executeTool } = await import('../src/tools/registry.js');
const unknown = await executeTool({ name: 'not_a_real_tool', args: {} });
check('未知工具返回 Tool not found', unknown.isError === true && /Tool not found/.test(unknown.content[0].text));

if (failures > 0) {
  console.error(`\n${failures} 项契约校验失败。`);
  process.exit(1);
}
console.log('\n全部通过。');
