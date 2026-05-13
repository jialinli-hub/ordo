# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## 按钮配色（前端）

全站按钮**仅允许三种色值**（含 hover 仅用 `color-mix` 与黑/白/灰混合，不引入第四种色相）。**明度层级**：主提交（`save`/`primary`）最深 → 新建（`create`）次之 → 默认实心（`default`）最浅，便于一眼区分重要程度。

| 色值 | 语义 | `Btn` / 类名 |
|------|------|----------------|
| `#263238` | 主提交：确定、保存、发送；破坏性主按钮为白底描边样式（`variant="danger"`）；危险文案链接（`btn-ordo-danger-text`） | `variant="save"`、`primary`、`danger`、危险文字 |
| `#529bba` | 默认实心按钮、次要操作、浅色背景上的文字按钮与链接 | `variant="default"`（及未覆盖时的 `--btn-bg` / `--btn-text-link`） |
| `#63b8a7` | 新建、创建、唤起弹窗等「开始一条新流程」 | `variant="create"` |

`:root` 中定义 `--ordo-btn-ink` / `--ordo-btn-blue` / `--ordo-btn-mint` 与 `--btn-save-*`、`--btn-create-*` 等派生变量；`.app-shell`、`.issue-panel`、`.issue-detail-shell`、`.team-settings-page`、`.oro-modal` 等按场景覆盖 `--btn-bg`、`--btn-text-link`。`ui/primitives.css` 的 `.btn-ordo-save` / `.btn-ordo-create` / `.btn-ordo-danger` 兜底渐变或描边与上表一致。新页面请只通过上述变量与 `Btn` 的 `variant` 扩展，勿写死其它色相。
