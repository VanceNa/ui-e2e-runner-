from pathlib import Path

from ui_audit_runner import (
    AuditSpec,
    KeyboardShortcut,
    NavigationStep,
    Viewport,
    button_click,
    button_style_consistency,
    checkbox_toggle,
    contrast_ratio,
    enter_triggers_default_button,
    icon_consistency,
    keyboard_shortcuts,
    menu_depth,
    message_clarity,
    navigation_flow,
    radio_select,
    responsive_layout,
    select_option,
    spacing_consistency,
    step_flow_status,
    table_integrity,
    tab_order,
    terminology_guard,
    text_quality,
    textbox_input,
    typography_consistency,
    window_alignment,
)


DEMO_URL = Path(__file__).with_name("demo_app.html").resolve().as_uri()


def prepare(context):
    context.page.evaluate(
        """
        () => {
          window.location.hash = '#home';
          const dialog = document.getElementById('child-dialog');
          const submitStatus = document.getElementById('submit-status');
          const keyword = document.getElementById('keyword');
          const owner = document.getElementById('owner');
          const stage = document.getElementById('stage');
          const basic = document.getElementById('choice-basic');
          const agreement = document.getElementById('agreement');
          const search = document.getElementById('global-search');

          if (dialog) {
            dialog.hidden = true;
          }
          if (submitStatus) {
            submitStatus.classList.remove('ready');
          }
          if (keyword) {
            keyword.value = '';
          }
          if (owner) {
            owner.value = '';
          }
          if (stage) {
            stage.value = 'draft';
          }
          if (basic) {
            basic.checked = false;
          }
          if (agreement) {
            agreement.checked = false;
          }
          if (search) {
            search.value = '';
          }
        }
        """
    )


SPEC = AuditSpec(
    name="内置示例页面 UI 审计",
    description="覆盖布局、视觉、控件、内容与导航五大类规则。",
    url=DEMO_URL,
    viewports=[
        Viewport("desktop", 1440, 900),
        Viewport("tablet", 1024, 768),
        Viewport("mobile", 390, 844),
    ],
    setup=prepare,
    checks=[
        spacing_consistency(".audit-row", tolerance_px=2, title="表单行间距一致性"),
        responsive_layout(
            required_selectors=["#main-window", ".side-nav", ".primary-action"],
            max_horizontal_overflow_px=0,
            title="不同分辨率下的响应式适配",
        ),
        typography_consistency(".audit-label", title="表单标签字体一致性"),
        button_style_consistency(".primary-action", title="主按钮显示一致性"),
        icon_consistency(".status-icon", title="LOGO 与图标风格一致性"),
        contrast_ratio(".primary-action, .hint-message, .status-copy", title="前景与背景对比协调度"),
        textbox_input("#keyword", "登录页布局审计", title="文本框输入响应"),
        select_option("#stage", value="review", expected_value="review", title="下拉框选择响应"),
        radio_select("#choice-basic", title="单选框响应"),
        checkbox_toggle("#agreement", checked=True, title="复选框响应"),
        tab_order(
            ["#owner", "#stage", "#choice-basic", "#agreement", "#save-form"],
            start_selector="#keyword",
            title="Tab 键导航顺序",
        ),
        enter_triggers_default_button("#owner", expect_selector="#submit-status.ready", title="Enter 触发默认按钮"),
        text_quality("body", title="文字乱码检查"),
        terminology_guard(
            required_terms=["UI审计", "当前步骤", "报告"],
            forbidden_terms=["乱码示例"],
            title="术语使用准确性",
        ),
        message_clarity(
            ".hint-message, #submit-status",
            required_keywords=["请", "当前"],
            title="提示与状态文案清晰度",
        ),
        table_integrity(".table-shell", require_scroll_or_pagination=True, title="表格与分页展示完整性"),
        navigation_flow(
            [
                NavigationStep(
                    name="进入详情页",
                    action_selector="#open-details",
                    expected_selector="#details-panel.is-active",
                    expected_url_contains="#details",
                    go_back=True,
                    back_expected_url_contains="#home",
                ),
                NavigationStep(
                    name="进入设置页",
                    action_selector="#go-settings",
                    expected_selector="#settings-panel.is-active",
                    expected_url_contains="#settings",
                    go_back=True,
                    back_expected_url_contains="#home",
                ),
            ],
            title="页面跳转与返回逻辑一致性",
        ),
        menu_depth(".side-nav > ul", max_depth=3, title="导航菜单层级不超过三层"),
        step_flow_status(
            ".wizard-steps .step",
            current_selector=".step--current",
            restriction_selector=".wizard-restriction",
            title="多步骤流程状态与限制提示",
        ),
        keyboard_shortcuts(
            [
                KeyboardShortcut("Alt+F", expect_active_selector="#global-search", description="聚焦搜索框"),
                KeyboardShortcut("Alt+D", expect_selector="#details-panel.is-active", description="打开详情页"),
                KeyboardShortcut("Alt+Shift+S", expect_selector="#settings-panel.is-active", description="打开设置页"),
            ],
            title="快捷键有效性与无冲突",
        ),
        button_click("#open-dialog", expect_selector="#child-dialog", title="按钮点击响应"),
        window_alignment(
            parent_selector="#main-window",
            child_selector="#child-dialog",
            parent_alignment="center",
            child_alignment="center",
            title="主窗体与子窗体位置规范",
        ),
    ],
)
