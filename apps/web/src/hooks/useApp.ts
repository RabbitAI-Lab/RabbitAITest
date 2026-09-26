'use client';

import { App } from 'antd';

/** client 侧统一取 Antd App 上下文（message/notification/modal），替代直接 App.useApp 以便复用。 */
export function useApp() {
  return App.useApp();
}
