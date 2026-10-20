import { startLifecycle } from './core/lifecycle.js';

startLifecycle().catch((error) => {
  console.error('[abm] service worker 初始化失败', error);
});

