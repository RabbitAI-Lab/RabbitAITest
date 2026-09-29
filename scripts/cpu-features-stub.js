// cpu-features 空桩（PLUG-005 勘误 1）：ssh2 的可选原生加速依赖，
// 缺失时 ssh2 自动回退纯 JS 实现——esbuild alias 到本文件规避 .node 解析（插件 tarball 单文件自包含纪律）。
module.exports = {};
