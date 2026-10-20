/**
 * 视频暂存区（扩展内存中的临时数据区）。
 *
 * 两条投递通道的终点都是这里：
 *   1. 视频桥（逐片推送 abm.video.chunk）；
 *   2. 扩展自己下载（browser_download_video_from_url）。
 * 之后 browser_set_video_to_page 从这里取出字节，喂给页面的 file input。
 *
 * ⚠️ 暂存区在 Service Worker 的内存里：SW 被回收（约 30 分钟空闲）后会丢，
 * 需要重新投递。TTL 见 VIDEO_RETENTION_MS。
 */

/** 暂存时长：与 browser_set_video_to_page 的读取逻辑一致 */
export const VIDEO_RETENTION_MS = 30 * 60 * 1000;

/** 页面侧接收分片的大小（与 bridge.html / 后端分片一致） */
export const VIDEO_CHUNK_BYTES = 20 * 1024 * 1024;

/** 单个视频上限（扩展侧限制） */
export const VIDEO_MAX_BYTES = 20 * 1024 * 1024 * 1024; // 20GB

/** 当前暂存的视频：{ fileName, fileType, fileSize, data, storedAt } */
let storedVideo = null;

/**
 * 写入暂存区。
 * @param {string} fileName
 * @param {string} fileType
 * @param {number} fileSize
 * @param {Uint8Array} data
 */
export function storeVideo(fileName, fileType, fileSize, data) {
  storedVideo = { fileName, fileType, fileSize, data, storedAt: Date.now() };
  return { success: true };
}

/** 读取暂存视频（过期自动清空）；没有则返回 null */
export function getStoredVideo() {
  if (!storedVideo) return null;
  if (Date.now() - storedVideo.storedAt > VIDEO_RETENTION_MS) {
    storedVideo = null;
    return null;
  }
  return storedVideo;
}

/** 清空暂存区 */
export function clearStoredVideo() {
  storedVideo = null;
}

/** 暂存视频的概要信息（不含字节）。 */
export function getStoredVideoInfo() {
  const video = getStoredVideo();
  if (!video) return { success: false };
  return {
    success: true,
    video: { fileName: video.fileName, fileType: video.fileType, fileSize: video.fileSize },
  };
}
