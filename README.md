# ui-audit-runner

面向 UI 自动化测试的 Python 审计工具骨架，重点覆盖以下五类检查：

- 布局与排版测试
- 视觉一致性测试
- 控件功能测试
- 内容准确性测试
- 导航与交互测试

这次重构已经移除了原仓库里和 `admin/member/marketing` 强绑定的 TypeScript 适配器、联动样例、dashboard 以及多余 Node 配置，项目现在收敛为一个更容易二次开发的 Python 脚本型工具。

## 安装

需要 Python `3.8+`。

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[browser]'
python -m playwright install chromium
```

在 `zsh` 里，`.[browser]` 需要加引号，否则会被当成通配符处理并报 `no matches found`。

## 运行

执行内置示例：

```bash
python -m ui_audit_runner run examples/sample_audit.py --output reports/sample-report.json
```

如果你新开了一个终端，还没有重新执行 `source .venv/bin/activate`，也可以直接使用虚拟环境里的 Python：

```bash
.venv/bin/python -m ui_audit_runner run examples/sample_audit.py --output reports/sample-report.json
```

也可以安装后直接使用命令：

```bash
ui-audit run examples/sample_audit.py --output reports/sample-report.json
```

## Python 脚本入口

审计脚本只需要暴露以下任一入口：

- `SPEC`
- `build_spec()`

示例：

```python
from ui_audit_runner import (
    AuditSpec,
    Viewport,
    spacing_consistency,
    responsive_layout,
)

SPEC = AuditSpec(
    name="示例页面审计",
    url="https://example.com",
    viewports=[
        Viewport("desktop", 1440, 900),
        Viewport("mobile", 390, 844),
    ],
    checks=[
        spacing_consistency(".form-row"),
        responsive_layout(required_selectors=["main", ".primary-action"]),
    ],
)
```

## 内置检查能力

### 1. 布局与排版

- `spacing_consistency`
  - 检查连续元素间距是否稳定
- `responsive_layout`
  - 检查不同分辨率下是否出现横向溢出、关键元素是否丢失
- `window_alignment`
  - 检查主窗体是否居中、子窗体是否位于左上角或正中

### 2. 视觉一致性

- `typography_consistency`
  - 检查字体、字号、文字颜色是否统一
- `button_style_consistency`
  - 检查按钮外观是否一致
- `icon_consistency`
  - 检查图标尺寸与颜色风格是否稳定
- `contrast_ratio`
  - 检查前景与背景对比度，并提示可能过于刺眼的颜色组合

### 3. 控件功能

- `button_click`
- `textbox_input`
- `select_option`
- `radio_select`
- `checkbox_toggle`
- `tab_order`
- `enter_triggers_default_button`
- `keyboard_shortcuts`

### 4. 内容准确性

- `text_quality`
  - 检查乱码、异常字符、可疑编码问题
- `terminology_guard`
  - 检查术语是否符合预期
- `message_clarity`
  - 检查提示/警告/错误文案是否清晰
- `table_integrity`
  - 检查表格列头、行数据完整性，以及滚动/分页能力

### 5. 导航与交互

- `navigation_flow`
  - 检查跳转与返回逻辑
- `menu_depth`
  - 检查导航层级是否超过三层
- `step_flow_status`
  - 检查多步骤流程是否展示当前状态与操作限制

## 项目结构

```text
ui_audit_runner/
  __init__.py
  __main__.py
  checks.py
  cli.py
  models.py
  runtime.py
examples/
  demo_app.html
  sample_audit.py
tests/
  test_models.py
  test_sample_audit.py
```

## 说明

- 这个工具是“规则引擎 + Python 脚本扩展”的结构，适合继续叠加你自己的业务页面和控件规则。
- 内置规则覆盖的是“可配置的通用 UI 规范检查”，不是完全无配置的 AI 视觉判断。
- 对“错别字”和“术语是否恰当”这类问题，默认能力主要依赖乱码检测、禁用词、必备术语词表；如果要更强校对，可以在 Python 脚本里追加自定义检查。
