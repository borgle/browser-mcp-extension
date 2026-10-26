/**
 * browser_extract_data：从页面提取数据。
 *
 * 参数：
 *   source    element(默认) | window | document
 *   selector  元素源必填
 *   path      window/document 源上的点分路径，如 `__INITIAL_STATE__.note.noteId`
 *   attribute 元素属性：text(默认)/html/outerHTML/value/checked/selected/href/src/
 *             className/id/tagName/exists，或任意自定义属性名
 *   all       是否返回所有匹配元素（数组）
 *   timeout   等待元素出现的超时，默认 5s
 * 返回 { success, source, selector, path, attribute, data }。
 */
import { BaseTool } from './base.js';
import { EXECUTION_WORLD } from '../constants.js';

export class ExtractDataTool extends BaseTool {
  name = 'browser_extract_data';

  async execute(args) {
    const { selector, path, attribute = 'text', source = 'element', all = false, timeout = 5000 } = args;
    try {
      const tab = await this.getTargetTab(args.tabId);
      if (!tab?.id) return this.createErrorResult('Could not find the target tab');

      let data;
      switch (source) {
        case 'window':
          data = await this.extractWindowData(tab.id, path || '');
          break;
        case 'document':
          data = await this.extractDocumentData(tab.id, path || '');
          break;
        default:
          if (!selector) return this.createErrorResult('selector is required when source is element');
          data = await this.extractElementData(tab.id, selector, attribute, all, timeout);
      }

      return this.createTextResult(
        JSON.stringify({
          success: true,
          source,
          selector: selector || undefined,
          path: path || undefined,
          attribute: source === 'element' ? attribute : undefined,
          data,
        }),
      );
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : 'Failed to extract data');
    }
  }

  /** 取 window 上的点分路径；不传 path 时返回常用的页面概览 */
  async extractWindowData(tabId, path) {
    return this.executeInTab(
      tabId,
      (dotPath) => {
        if (!dotPath) {
          return {
            location: {
              href: window.location.href,
              pathname: window.location.pathname,
              search: window.location.search,
              hash: window.location.hash,
            },
            title: document.title,
            __INITIAL_STATE__: window.__INITIAL_STATE__ || null,
          };
        }
        let value = window;
        for (const key of dotPath.split('.')) {
          if (!value || typeof value !== 'object' || !(key in value)) return undefined;
          value = value[key];
        }
        try {
          return JSON.parse(JSON.stringify(value));
        } catch {
          return String(value);
        }
      },
      [path],
      // 页面自己挂的全局（__INITIAL_STATE__ 之类）在 ISOLATED world 里看不见，
      // 必须在 MAIN world 读——否则这个工具会静默返回 null。
      EXECUTION_WORLD.MAIN,
    );
  }

  /** 取 document 上的点分路径；不传 path 时返回文档概览 */
  async extractDocumentData(tabId, path) {
    return this.executeInTab(
      tabId,
      (dotPath) => {
        if (!dotPath) {
          return {
            title: document.title,
            url: document.URL,
            readyState: document.readyState,
            characterSet: document.characterSet,
          };
        }
        let value = document;
        for (const key of dotPath.split('.')) {
          if (!value || typeof value !== 'object' || !(key in value)) return undefined;
          value = value[key];
        }
        try {
          return JSON.parse(JSON.stringify(value));
        } catch {
          return String(value);
        }
      },
      [path],
      EXECUTION_WORLD.MAIN,
    );
  }

  async extractElementData(tabId, selector, attribute, all, timeoutMs) {
    if (!(await this.waitForElement(tabId, selector, timeoutMs))) {
      throw new Error(`Element not found: ${selector}`);
    }
    return this.executeInTab(
      tabId,
      (sel, attr, returnAll) => {
        const nodes = returnAll
          ? Array.from(document.querySelectorAll(sel))
          : [document.querySelector(sel)].filter((node) => node !== null);
        if (nodes.length === 0) return null;

        const read = (node) => {
          if (!node) return null;
          switch (attr) {
            case 'text':
              return node.innerText || node.textContent;
            case 'html':
              return node.innerHTML;
            case 'outerHTML':
              return node.outerHTML;
            case 'value':
              return node.value;
            case 'checked':
              return node.checked;
            case 'selected':
              return node.selected;
            case 'href':
              return node.href;
            case 'src':
              return node.src;
            case 'className':
              return node.className;
            case 'id':
              return node.id;
            case 'tagName':
              return node.tagName;
            case 'exists':
              return true;
            default:
              return node.getAttribute(attr);
          }
        };
        return returnAll ? nodes.map(read) : read(nodes[0]);
      },
      [selector, attribute, all],
    );
  }

  /** 轮询等待元素出现；执行失败会直接抛出。 */
  async waitForElement(tabId, selector, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.executeInTab(tabId, (sel) => document.querySelector(sel) !== null, [selector])) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }
}
