/** 通用小工具：延时、随机数、base64 编码（浏览器环境无 Buffer，用 btoa 分块实现）。 */

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** [min, max] 闭区间随机整数（模拟真人操作时用） */
export function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/** Uint8Array → base64；分块避免 String.fromCharCode 参数过多导致栈溢出 */
export function uint8ArrayToBase64(bytes, blockSize = 32768) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    const slice = bytes.subarray(offset, offset + blockSize);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

/** 文本 → gzip → base64（给 MCP 传输瘦身，Claude/Codex 侧能读 gzip+base64 约定） */
export async function gzipToBase64(text) {
  const encoder = new TextEncoder();
  const reader = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  })
    .pipeThrough(new CompressionStream('gzip'))
    .getReader();

  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return uint8ArrayToBase64(merged);
}
