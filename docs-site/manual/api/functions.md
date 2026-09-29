# 参数化与内置函数

参数化让同一条请求 / 场景按不同数据重复执行：变量引用与环境联动、参数提取器在步骤间传递数据、内置函数生成动态值、CSV 提供批量数据驱动。本文是这些能力的语法手册。

## 概念

### 变量引用 `${var}`

请求的 URL、参数、请求头、请求体中均可写 `${var}`，执行时按**作用域链**解析：

```text
临时变量（temp） > 任务参数 > 环境变量（env）
```

- URL 支持**相对路径**：以 `/` 或 `${` 开头的 URL 由所选环境的域名拼接（路径条件 > 模块 > 默认）。
- 环境变量在[环境管理](manual/project/environment.md)中维护；临时变量由提取器或脚本 `setVar` 写入。

### 变量管道（后处理）

引用变量时可追加管道函数加工取值：

```text
${token|md5}          ${token|base64}
${name|toUpperCase}   ${token|substr(0,6)}
${host|default(localhost)}
```

| 管道 | 语法 | 说明 |
| ---- | ---- | ---- |
| md5 | `${var|md5}` | MD5 摘要 |
| sha256 | `${var|sha256}` | SHA256 摘要 |
| base64 | `${var|base64}` | Base64 编码 |
| substr | `${var|substr(0,6)}` | 取子串 |
| toUpperCase / toLowerCase | `${name|toUpperCase}` | 大小写转换 |
| trim | `${name|trim}` | 去首尾空白 |
| default | `${host|default(localhost)}` | 空值兜底 |

## 内置函数

### 引擎函数（`__` 前缀，运行时求值）

| 函数 | 语法 | 说明 |
| ---- | ---- | ---- |
| `__counter` | `${__counter(key)}` | 任务内自增计数（按 key 分组，1 起） |
| `__random` | `${__random(1,9)}` | 区间随机整数 |
| `__UUID` | `${__UUID()}` | 随机 UUID v4 |
| `__time` | `${__time(yyyy-MM-dd)}` | 当前时间格式化 |
| `__timeShift` | `${__timeShift(3600,HH:mm)}` | 偏移秒数后的时间 |
| `__digest` | `${__digest(md5,abc)}` | 摘要，算法 md5 / sha1 / sha256 |
| `__base64` | `${__base64(hello)}` | Base64 编码 |
| `__urlEncode` | `${__urlEncode(a b)}` | URL 编码 |
| `__isVarDefined` | `${__isVarDefined(token)}` | 变量是否已定义（true/false） |
| `__threadName` | `${__threadName()}` | 场景名标识 |

### 测试数据函数（`@` 前缀，随机造数）

| 函数 | 语法 | 说明 |
| ---- | ---- | ---- |
| `@string` | `@string(8)` | 随机小写字母串 |
| `@integer` | `@integer(18,60)` | 随机整数 |
| `@float` | `@float(0,1)` | 随机浮点（两位小数） |
| `@name` | `@name()` | 随机中文姓名 |
| `@email` | `@email()` | 随机邮箱 |
| `@phone` | `@phone()` | 随机手机号（13 段） |
| `@date` | `@date(yyyy-MM-dd)` | 随机日期（2020 起） |
| `@datetime` | `@datetime()` | 随机日期时间 |
| `@address` | `@address()` | 随机省市 |
| `@idcard` | `@idcard()` | 合规校验位身份证号 |
| `@regexp` | `@regexp(\d+,abc123)` | 正则首匹配（失败原样返回） |
| `@pick` | `@pick(A,B,O)` | 列表随机取一 |

## 参数提取（Extractor）

提取器从响应中取值供后续步骤使用，四个维度组合：

| 维度 | 取值 |
| ---- | ---- |
| 来源 | body / headers |
| 方式 | regex / jsonpath |
| 匹配策略 | first（首个）/ random（随机）/ n（第 n 个） |
| 作用域 | temp（任务内临时）/ env（写回环境变量） |

典型用法：登录请求的提取器把响应中的 `token` 以 jsonpath `$.data.token` 提取到 temp，后续步骤的请求头直接引用 `${token}`。

## CSV 数据驱动

场景可绑定 CSV 数据集做数据驱动：

| 配置 | 说明 |
| ---- | ---- |
| 来源 | file（引用项目文件）/ inline（内联文本） |
| 分隔符 | `,` `;` `\t` 三种 |
| 上限 | 最大 10000 行 × 200 列 |
| 坏行 | 列数不符的行跳过并计数，不中断执行 |
| 迭代 | 外层 foreach：每行数据跑一轮子步骤，行内列以 `${列名}` 引用 |

```text
username,password,expect
alice,123456,0
bob,bad-pass,1001
```

配合 loop(foreach) 时，上述 CSV 会让登录步骤分别以两行数据各执行一次，`expect` 用于断言期望值。

## 边界与注意事项

!> 引用未定义变量时渲染结果为空：关键变量建议用 `${var|default(x)}` 兜底，或先用 `__isVarDefined` 断言确认。

!> CSV 坏行会被跳过并计入坏行数（报告可见），请保证文件列数一致；超出行列上限会被拒绝。

!> env 作用域的提取会写回环境变量，对同环境后续任务可见；仅任务内使用请选 temp。

## 相关链接

- [接口测试概述](manual/api/overview.md)
- [自动化场景](manual/api/scenario.md)
- [接口调试](manual/api/debug.md)
- [环境管理](manual/project/environment.md)
