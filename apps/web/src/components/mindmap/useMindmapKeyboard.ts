"use client";

/**
 * CASE-007 脑图快捷键 hook（快捷键状态机的浏览器侧入口）。
 *
 * - window keydown 统一分发；enabled=false 完全不监听（只读模式）；
 * - 编辑态（isEditing 或事件目标在输入控件内）只放行 Escape（发出 "escape"，用于退出编辑/清除选择）；
 * - Tab / 方向键 / Backspace / Enter preventDefault 拦截默认行为（Tab 焦点逃逸、页面滚动、浏览器后退）；
 * - 修饰键组合一律忽略、交还浏览器默认（Ctrl+C/X/V 剪贴板登记 Backlog），唯一例外 Ctrl/Meta+Enter；
 * - M/C 大小写均识别；无 Shift 修饰（Shift+M 等按修饰键忽略处理）。
 */

import { useEffect } from "react";

export type MindmapKey =
  | "enter"
  | "tab"
  | "ctrl-enter"
  | "m"
  | "c"
  | "backspace"
  | "f2"
  | "up"
  | "down"
  | "left"
  | "right"
  | "escape";

export interface UseMindmapKeyboardOptions {
  enabled: boolean;
  isEditing: boolean;
  onKey: (key: MindmapKey) => void;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function useMindmapKeyboard(opts: UseMindmapKeyboardOptions): void {
  const { enabled, isEditing, onKey } = opts;

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const editing = isEditing || isTextEntryTarget(e.target);
      if (e.key === "Escape") {
        onKey("escape");
        if (editing) e.preventDefault();
        return;
      }
      if (editing) return; // 输入中：只放行 Escape

      const hasModifier = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;
      if (hasModifier) {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === "Enter") {
          e.preventDefault();
          onKey("ctrl-enter");
        }
        return; // 其余修饰组合（Ctrl+C/X/V 等）保留浏览器默认
      }

      switch (e.key) {
        case "Enter":
          e.preventDefault();
          onKey("enter");
          break;
        case "Tab":
          e.preventDefault(); // 拦截焦点逃逸
          onKey("tab");
          break;
        case "Backspace":
          e.preventDefault(); // 拦截浏览器后退等默认行为
          onKey("backspace");
          break;
        case "ArrowUp":
          e.preventDefault();
          onKey("up");
          break;
        case "ArrowDown":
          e.preventDefault();
          onKey("down");
          break;
        case "ArrowLeft":
          e.preventDefault();
          onKey("left");
          break;
        case "ArrowRight":
          e.preventDefault();
          onKey("right");
          break;
        case "F2":
          onKey("f2");
          break;
        case "m":
        case "M":
          onKey("m");
          break;
        case "c":
        case "C":
          onKey("c");
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, isEditing, onKey]);
}
