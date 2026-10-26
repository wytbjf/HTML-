# HTML 代码格式化工具

一个完全离线、单文件运行的 HTML / CSS / JavaScript 源码排版工具。批量导入 `.html` / `.htm` 文件，在浏览器内整理缩进与换行，并在导出前逐项校验「非空白字符没有变化」。

工具不联网、不上传、不修改原文件；打开根目录的 `HTML_代码格式化工具.html` 即可使用，无需安装 Node.js 或任何后端服务。

## 特性

- **离线单文件**：所有依赖打包进一个 HTML，双击即可使用。页面通过 CSP 禁止一切网络请求。
- **批量处理**：拖拽、多选文件或整个文件夹；导出的 ZIP 保留原有目录层级。
- **保守格式化**：固定每级 2 个空格；不添加分号、不改引号、不重排属性、不修复语法错误。
- **多语言支持**：CSS 由 PostCSS 解析，JavaScript 由 Acorn + js-beautify 处理，Vue 3 挂载模板使用 Vue 官方编译器校验。
- **一致性校验**：格式化前后比对词法单元、语法树、CSS 结构签名和 Vue 模板编译结果；任何一项不通过，对应区域或整个文件保留原样并给出说明。
- **编码保留**：支持 UTF-8、带 BOM 的 UTF-8 / UTF-16 LE / UTF-16 BE，保留 BOM 与原有换行风格。
- **只读输入**：工具只读取原文件，没有写回原路径的功能。

## 快速开始

### 直接使用

1. 下载或克隆本仓库。
2. 使用 Microsoft Edge 或 Google Chrome 打开 `HTML_代码格式化工具.html`。
3. 拖入文件 → 点击「开始格式化」→ 查看一致性检查 → 下载全部 ZIP。

详细操作、处理范围与已知限制见 [使用说明.md](使用说明.md)。

### 从源码构建

需要 Node.js 22 或更新版本：

```bash
cd 源码
npm install
npm run build
```

构建产物为 `源码/dist/HTML_代码格式化工具.html`，可独立离线使用。首次安装依赖需要联网，构建结果不需要。

## 工作原理

处理流程是「解析 → 局部重排 → 全量复核」，而不是直接套用通用 beautifier：

1. 词法扫描 HTML，识别标签、注释、文本节点、Vue 表达式，以及 `script` / `style` / `pre` / `textarea` / `title` 等原始内容区。
2. 分别格式化 `script` 与 `style` 区域，并在格式化后重新解析、比对结果。
3. 仅在 `<head>` 和通过校验的 Vue 3 挂载模板中调整元素间空白；静态正文的文本节点和元素间空白原样保留，避免改变行内布局或受 `white-space` 影响的显示。
4. 应用修改后重新扫描整份文档，复核标签、属性、文字、注释与空白敏感区域。
5. 任意校验失败时回退到原始内容（模板区域可单独回退），并把原因显示在预览面板中。

### 会处理什么

| 区域 | 处理方式 |
| --- | --- |
| `<script>` 内的 JavaScript | 调整缩进与换行，逐 token 比对词法单元与 AST，字符串、模板字符串、正则和注释原样回填 |
| `<style>` 内的 CSS | 调整选择器、声明与注释的空白，比对属性、取值、选择器与注释 |
| Vue 3 挂载模板 | 仅在识别到 `createApp(...).mount('#id')` 或 `template: '#id'` 时处理，并比对模板编译结果 |
| `<head>` 中的元素间空白 | 按层级整理为每级 2 个空格 |
| 动态绑定的 Vue 指令与表达式 | 原样保留，仅调整外部空白 |

### 会保留什么

- 静态正文的文本节点与元素间空白。
- `<pre>`、`<textarea>`、`<title>`、`<xmp>` 等空白敏感内容。
- `v-pre` 区域、`<svg>`、`<math>`、`<noscript>`。
- 带自定义 `compilerOptions`、`delimiters` 或 `whitespace: 'preserve'` 的 Vue 应用。
- 标签层级不完整、省略闭合标签、CSS / JS 无法解析或校验失败的区域。

### 一致性检查

导出前工具会确认：

- 非空白字符序列保持不变；
- 标签、属性与 HTML 注释逐一相同；
- 文字、Vue 表达式与注释相同；
- 字符串、模板字符串与空白敏感区域逐字相同；
- JavaScript 的词法单元与语法树相同（AST 比较忽略位置信息）；
- CSS 的属性、取值、选择器与注释相同；
- Vue 模板格式化前后的编译产物相同（使用内置 Vue 3.5.24 编译器）。

这是一致性检查，不是对运行时页面逐像素验证；工具也不会执行导入的 HTML 或脚本。

## 使用限制

- 仅处理 `.html` / `.htm`，不是 `.vue` 单文件组件格式化器。
- 单个 HTML 文件上限 10 MB；不下载或打包图片、CSS、JavaScript 等外部依赖。
- 不支持无 BOM 的 UTF-16 文件，请先另存为 UTF-8。
- 不压缩代码、不重排属性、不增删元素、不修复已有语法错误。
- 页面刷新或关闭后，文件列表与预览会清空；不上传、不保存历史。
- ZIP 中若出现完整路径冲突，会为后一个副本添加数字后缀。

## 项目结构

```text
HTML_Formatter_Tool/
├─ HTML_代码格式化工具.html   # 构建产物：可直接打开的离线单文件工具
├─ README.md
├─ LICENSE                    # MIT 许可证
├─ 使用说明.md                # 面向使用者的操作说明
├─ THIRD_PARTY_LICENSES.txt   # 内置依赖的许可全文
└─ 源码/
   ├─ src/shell.html          # 页面结构与样式，构建时注入脚本
   ├─ src/app.js              # 交互、批量导入、进度与 ZIP 导出
   ├─ src/core.js             # 解析、格式化、一致性校验与编解码
   ├─ build.mjs               # esbuild 打包并内联为单文件 HTML
   └─ package.json
```

## 开发

`build.mjs` 使用 esbuild 将 `src/app.js` 及其依赖打包为 IIFE、压缩为 ES2020，内联进 `src/shell.html`，输出到 `源码/dist/`。构建时会检查打包结果中不含 `</script`，避免破坏内联脚本。

页面还暴露一个只读的数据 API，便于在浏览器控制台或自动化测试中检查核心逻辑，不会执行导入的 HTML：

```js
HTMLFormatter.formatSource(source, { formatVue: true });
HTMLFormatter.decodeFile(bytes);
HTMLFormatter.encodeFile(source, decoded);
```

修改源码后，建议重点复核字符串与注释、静态 HTML 空白、Vue 模板编译一致性以及编码保留行为。

## 技术栈

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| [acorn](https://github.com/acornjs/acorn) | 8.19.0 | JavaScript 解析、词法单元与 AST 比对、Vue 表达式边界识别 |
| [js-beautify](https://github.com/beautifier/js-beautify) | 2.0.3 | JavaScript 缩进与换行 |
| [PostCSS](https://github.com/postcss/postcss) | 8.5.31 | CSS 解析与空白调整 |
| [@vue/compiler-dom](https://github.com/vuejs/core) | 3.5.24 | Vue 3 模板编译与一致性校验 |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.2 | 浏览器端 ZIP 打包 |
| [esbuild](https://github.com/evanw/esbuild) | 0.25.12 | 构建期打包与压缩 |

## 许可

本项目以 [MIT 许可证](LICENSE) 发布。内置第三方依赖的许可全文见 [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt)。
