import { defineConfig } from "vitest/config";

/** 引擎单测定位：src/__tests__（S13 UIT-003 起，防 .uit-run 脚本工作区的 *.spec.ts 被误收集）。 */
export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
