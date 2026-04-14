from __future__ import annotations

import colorsys
import re
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

from .models import AuditCheck, KeyboardShortcut, NavigationStep


LAYOUT = "布局与排版"
VISUAL = "视觉一致性"
CONTROL = "控件功能"
CONTENT = "内容准确性"
NAVIGATION = "导航与交互"


def slugify(value: str) -> str:
    text = re.sub(r"[^0-9a-zA-Z\u4e00-\u9fff]+", "-", value.strip().lower())
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text or "check"


def custom_check(title: str, category: str, executor: Callable[[Any], Any], check_id: Optional[str] = None) -> AuditCheck:
    identifier = check_id or slugify(title)

    def _run(context: Any):
        result = executor(context)
        if hasattr(result, "status"):
            return result
        raise TypeError("custom_check 回调必须返回 AuditResult")

    return AuditCheck(check_id=identifier, title=title, category=category, executor=_run)


def _make_check(title: str, category: str, executor: Callable[[Any], Any], check_id: Optional[str] = None) -> AuditCheck:
    return AuditCheck(check_id=check_id or slugify(title), title=title, category=category, executor=executor)


def _color_to_rgba(raw: str) -> Optional[Tuple[float, float, float, float]]:
    if not raw:
        return None
    value = raw.strip().lower()
    if value in ("transparent", "inherit", "initial"):
        return None
    hex_match = re.match(r"^#([0-9a-f]{3}|[0-9a-f]{6})$", value)
    if hex_match:
        token = hex_match.group(1)
        if len(token) == 3:
            token = "".join(ch * 2 for ch in token)
        return (
            int(token[0:2], 16),
            int(token[2:4], 16),
            int(token[4:6], 16),
            1.0,
        )

    rgb_match = re.match(r"^rgba?\(([^)]+)\)$", value)
    if not rgb_match:
        return None

    parts = [item.strip() for item in rgb_match.group(1).split(",")]
    if len(parts) < 3:
        return None

    def _channel(token: str) -> float:
        if token.endswith("%"):
            return max(0.0, min(255.0, float(token[:-1]) * 2.55))
        return max(0.0, min(255.0, float(token)))

    red = _channel(parts[0])
    green = _channel(parts[1])
    blue = _channel(parts[2])
    alpha = float(parts[3]) if len(parts) > 3 else 1.0
    return red, green, blue, alpha


def _blend_rgba(foreground: Tuple[float, float, float, float], background: Tuple[float, float, float, float]) -> Tuple[float, float, float]:
    fg_alpha = foreground[3]
    bg_alpha = background[3]
    out_alpha = fg_alpha + bg_alpha * (1 - fg_alpha)
    if out_alpha <= 0:
        return 255.0, 255.0, 255.0
    channels = []
    for index in range(3):
        value = (
            foreground[index] * fg_alpha + background[index] * bg_alpha * (1 - fg_alpha)
        ) / out_alpha
        channels.append(value)
    return channels[0], channels[1], channels[2]


def _srgb_to_linear(channel: float) -> float:
    ratio = channel / 255.0
    if ratio <= 0.03928:
        return ratio / 12.92
    return ((ratio + 0.055) / 1.055) ** 2.4


def _relative_luminance(rgb: Tuple[float, float, float]) -> float:
    red = _srgb_to_linear(rgb[0])
    green = _srgb_to_linear(rgb[1])
    blue = _srgb_to_linear(rgb[2])
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def _contrast_value(foreground: str, background: str) -> Optional[float]:
    fg = _color_to_rgba(foreground)
    bg = _color_to_rgba(background)
    if fg is None or bg is None:
        return None
    fg_rgb = _blend_rgba(fg, bg)
    bg_rgb = _blend_rgba(bg, (255.0, 255.0, 255.0, 1.0))
    lighter = max(_relative_luminance(fg_rgb), _relative_luminance(bg_rgb))
    darker = min(_relative_luminance(fg_rgb), _relative_luminance(bg_rgb))
    return (lighter + 0.05) / (darker + 0.05)


def _is_harsh_color_pair(foreground: str, background: str, ratio: float) -> bool:
    fg = _color_to_rgba(foreground)
    bg = _color_to_rgba(background)
    if fg is None or bg is None:
        return False
    fg_rgb = tuple(channel / 255.0 for channel in _blend_rgba(fg, bg))
    bg_rgb = tuple(channel / 255.0 for channel in _blend_rgba(bg, (255.0, 255.0, 255.0, 1.0)))

    fg_hls = colorsys.rgb_to_hls(fg_rgb[0], fg_rgb[1], fg_rgb[2])
    bg_hls = colorsys.rgb_to_hls(bg_rgb[0], bg_rgb[1], bg_rgb[2])
    hue_gap = abs(fg_hls[0] - bg_hls[0])
    hue_gap = min(hue_gap, 1.0 - hue_gap)
    return ratio >= 10.0 and (fg_hls[2] >= 0.85 or bg_hls[2] >= 0.85) and hue_gap >= 0.28


def _format_signature(signature: Iterable[Tuple[str, Any]]) -> str:
    return ", ".join("{0}={1}".format(key, value) for key, value in signature)


def _wait_for_url_contains(page: Any, value: str, timeout_ms: int) -> None:
    page.wait_for_function(
        "(expected) => window.location.href.indexOf(expected) >= 0",
        arg=value,
        timeout=timeout_ms,
    )


def _style_consistency_check(
    title: str,
    selector: str,
    fields: Sequence[str],
    category: str,
    max_unique_styles: int = 1,
    check_id: Optional[str] = None,
) -> AuditCheck:
    def _executor(context: Any):
        styles = context.page.eval_on_selector_all(
            selector,
            """
            (nodes, fields) => nodes
              .map((node) => {
                const rect = node.getBoundingClientRect();
                const computed = window.getComputedStyle(node);
                if (
                  rect.width <= 0 ||
                  rect.height <= 0 ||
                  computed.display === 'none' ||
                  computed.visibility === 'hidden'
                ) {
                  return null;
                }
                const values = {};
                fields.forEach((field) => {
                  values[field] = computed[field];
                });
                return {
                  tag: node.tagName.toLowerCase(),
                  text: (node.innerText || node.textContent || '').trim().slice(0, 40),
                  values,
                };
              })
              .filter(Boolean)
            """,
            list(fields),
        )

        if len(styles) < 2:
            return context.result(
                check_id=check_id or slugify(title),
                title=title,
                category=category,
                status="skipped",
                summary="可比较的可见元素少于 2 个，跳过一致性检查",
            )

        signature_count = {}
        for item in styles:
            signature = tuple((field, item["values"].get(field, "")) for field in fields)
            signature_count[signature] = signature_count.get(signature, 0) + 1

        signatures = sorted(signature_count.items(), key=lambda pair: pair[1], reverse=True)
        passed = len(signature_count) <= max_unique_styles
        details = ["样式簇数量: {0}".format(len(signature_count))]
        for signature, count in signatures[:3]:
            details.append("{0} 个元素 -> {1}".format(count, _format_signature(signature)))

        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=category,
            status="passed" if passed else "failed",
            summary="发现 {0} 种样式，阈值 <= {1}".format(len(signature_count), max_unique_styles),
            details=details,
            metrics={"selector": selector, "unique_styles": len(signature_count)},
        )

    return _make_check(title=title, category=category, executor=_executor, check_id=check_id)


def spacing_consistency(
    selector: str,
    axis: str = "y",
    tolerance_px: float = 8.0,
    title: str = "页面间距一致性",
    check_id: Optional[str] = None,
) -> AuditCheck:
    def _executor(context: Any):
        items = context.page.eval_on_selector_all(
            selector,
            """
            (nodes) => nodes
              .map((node) => {
                const rect = node.getBoundingClientRect();
                const style = window.getComputedStyle(node);
                if (
                  rect.width <= 0 ||
                  rect.height <= 0 ||
                  style.display === 'none' ||
                  style.visibility === 'hidden'
                ) {
                  return null;
                }
                return {
                  top: Number(rect.top.toFixed(2)),
                  left: Number(rect.left.toFixed(2)),
                  width: Number(rect.width.toFixed(2)),
                  height: Number(rect.height.toFixed(2)),
                  text: (node.innerText || node.textContent || '').trim().slice(0, 40),
                };
              })
              .filter(Boolean)
            """,
        )

        if len(items) < 3:
            return context.result(
                check_id=check_id or slugify(title),
                title=title,
                category=LAYOUT,
                status="skipped",
                summary="可比较元素少于 3 个，跳过间距检查",
            )

        primary = "top" if axis == "y" else "left"
        secondary = "left" if axis == "y" else "top"
        size_key = "height" if axis == "y" else "width"
        items = sorted(items, key=lambda item: (item[primary], item[secondary]))

        gaps = []
        for previous, current in zip(items, items[1:]):
            gap = round(current[primary] - (previous[primary] + previous[size_key]), 2)
            if gap >= 0:
                gaps.append(gap)

        if len(gaps) < 2:
            return context.result(
                check_id=check_id or slugify(title),
                title=title,
                category=LAYOUT,
                status="skipped",
                summary="无法形成有效的连续间距序列",
            )

        spread = max(gaps) - min(gaps)
        passed = spread <= tolerance_px
        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=LAYOUT,
            status="passed" if passed else "failed",
            summary="间距波动 {0:.2f}px，阈值 <= {1:.2f}px".format(spread, tolerance_px),
            details=["间距序列: {0}".format(", ".join("{0:.2f}".format(item) for item in gaps))],
            metrics={"selector": selector, "gaps": gaps, "spread": spread},
        )

    return _make_check(title=title, category=LAYOUT, executor=_executor, check_id=check_id)


def responsive_layout(
    required_selectors: Optional[Sequence[str]] = None,
    max_horizontal_overflow_px: int = 0,
    title: str = "响应式布局适配",
    check_id: Optional[str] = None,
) -> AuditCheck:
    required = list(required_selectors or [])

    def _executor(context: Any):
        metrics = context.page.evaluate(
            """
            (requiredSelectors) => {
              const root = document.documentElement;
              const body = document.body;
              const hiddenSelectors = [];
              requiredSelectors.forEach((selector) => {
                const node = document.querySelector(selector);
                if (!node) {
                  hiddenSelectors.push(selector);
                  return;
                }
                const rect = node.getBoundingClientRect();
                const style = window.getComputedStyle(node);
                if (
                  rect.width <= 0 ||
                  rect.height <= 0 ||
                  style.display === 'none' ||
                  style.visibility === 'hidden'
                ) {
                  hiddenSelectors.push(selector);
                }
              });
              return {
                innerWidth: window.innerWidth,
                innerHeight: window.innerHeight,
                scrollWidth: Math.max(root.scrollWidth, body ? body.scrollWidth : 0),
                scrollHeight: Math.max(root.scrollHeight, body ? body.scrollHeight : 0),
                hiddenSelectors,
              };
            }
            """,
            required,
        )

        overflow_x = max(0, metrics["scrollWidth"] - metrics["innerWidth"])
        passed = overflow_x <= max_horizontal_overflow_px and not metrics["hiddenSelectors"]
        details = [
            "viewport={0}x{1}, scroll={2}x{3}".format(
                metrics["innerWidth"],
                metrics["innerHeight"],
                metrics["scrollWidth"],
                metrics["scrollHeight"],
            )
        ]
        if metrics["hiddenSelectors"]:
            details.append("缺失/不可见元素: {0}".format(", ".join(metrics["hiddenSelectors"])))

        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=LAYOUT,
            status="passed" if passed else "failed",
            summary="横向溢出 {0}px，关键元素缺失 {1} 个".format(overflow_x, len(metrics["hiddenSelectors"])),
            details=details,
            metrics={"overflow_x": overflow_x, "hidden_selectors": metrics["hiddenSelectors"]},
        )

    return _make_check(title=title, category=LAYOUT, executor=_executor, check_id=check_id)


def window_alignment(
    parent_selector: str,
    child_selector: Optional[str] = None,
    parent_alignment: str = "center",
    child_alignment: str = "center",
    tolerance_px: float = 24.0,
    title: str = "主窗体与子窗体位置规范",
    check_id: Optional[str] = None,
) -> AuditCheck:
    def _offsets(box: Dict[str, float], container: Dict[str, float], alignment: str) -> Tuple[float, float]:
        if alignment == "top-left":
            return abs(box["left"] - container["left"]), abs(box["top"] - container["top"])
        return (
            abs((box["left"] + box["width"] / 2.0) - (container["left"] + container["width"] / 2.0)),
            abs((box["top"] + box["height"] / 2.0) - (container["top"] + container["height"] / 2.0)),
        )

    def _executor(context: Any):
        metrics = context.page.evaluate(
            """
            (args) => {
              const getBox = (selector) => {
                const node = document.querySelector(selector);
                if (!node) {
                  return null;
                }
                const rect = node.getBoundingClientRect();
                return {
                  left: Number(rect.left.toFixed(2)),
                  top: Number(rect.top.toFixed(2)),
                  width: Number(rect.width.toFixed(2)),
                  height: Number(rect.height.toFixed(2)),
                };
              };

              return {
                viewport: {
                  left: 0,
                  top: 0,
                  width: Number(window.innerWidth.toFixed(2)),
                  height: Number(window.innerHeight.toFixed(2)),
                },
                parent: getBox(args.parentSelector),
                child: args.childSelector ? getBox(args.childSelector) : null,
              };
            }
            """,
            {"parentSelector": parent_selector, "childSelector": child_selector},
        )

        if metrics["parent"] is None:
            return context.result(
                check_id=check_id or slugify(title),
                title=title,
                category=LAYOUT,
                status="failed",
                summary="未找到主窗体选择器: {0}".format(parent_selector),
            )

        parent_dx, parent_dy = _offsets(metrics["parent"], metrics["viewport"], parent_alignment)
        passed = parent_dx <= tolerance_px and parent_dy <= tolerance_px
        details = [
            "主窗体偏移: dx={0:.2f}px dy={1:.2f}px".format(parent_dx, parent_dy),
            "主窗体对齐模式: {0}".format(parent_alignment),
        ]

        if child_selector:
            if metrics["child"] is None:
                return context.result(
                    check_id=check_id or slugify(title),
                    title=title,
                    category=LAYOUT,
                    status="failed",
                    summary="未找到子窗体选择器: {0}".format(child_selector),
                    details=details,
                )

            child_dx, child_dy = _offsets(metrics["child"], metrics["parent"], child_alignment)
            passed = passed and child_dx <= tolerance_px and child_dy <= tolerance_px
            details.append("子窗体偏移: dx={0:.2f}px dy={1:.2f}px".format(child_dx, child_dy))
            details.append("子窗体对齐模式: {0}".format(child_alignment))

        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=LAYOUT,
            status="passed" if passed else "failed",
            summary="主/子窗体位置检查阈值 <= {0:.2f}px".format(tolerance_px),
            details=details,
            metrics={"parent_selector": parent_selector, "child_selector": child_selector or ""},
        )

    return _make_check(title=title, category=LAYOUT, executor=_executor, check_id=check_id)


def typography_consistency(
    selector: str,
    fields: Sequence[str] = ("fontFamily", "fontSize", "fontWeight", "color"),
    max_unique_styles: int = 1,
    title: str = "字体与字号一致性",
    check_id: Optional[str] = None,
) -> AuditCheck:
    return _style_consistency_check(
        title=title,
        selector=selector,
        fields=fields,
        category=VISUAL,
        max_unique_styles=max_unique_styles,
        check_id=check_id,
    )


def button_style_consistency(
    selector: str,
    fields: Sequence[str] = ("fontSize", "color", "backgroundColor", "borderRadius", "height"),
    max_unique_styles: int = 1,
    title: str = "按钮样式一致性",
    check_id: Optional[str] = None,
) -> AuditCheck:
    return _style_consistency_check(
        title=title,
        selector=selector,
        fields=fields,
        category=VISUAL,
        max_unique_styles=max_unique_styles,
        check_id=check_id,
    )


def icon_consistency(
    selector: str,
    fields: Sequence[str] = ("width", "height", "color"),
    max_unique_styles: int = 1,
    title: str = "图标风格一致性",
    check_id: Optional[str] = None,
) -> AuditCheck:
    return _style_consistency_check(
        title=title,
        selector=selector,
        fields=fields,
        category=VISUAL,
        max_unique_styles=max_unique_styles,
        check_id=check_id,
    )


def contrast_ratio(
    selector: str,
    min_ratio: float = 4.5,
    allow_harsh_pairs: int = 0,
    title: str = "前景背景对比度",
    check_id: Optional[str] = None,
) -> AuditCheck:
    def _executor(context: Any):
        samples = context.page.eval_on_selector_all(
            selector,
            """
            (nodes) => {
              const findBackground = (node) => {
                let current = node;
                while (current) {
                  const bg = window.getComputedStyle(current).backgroundColor;
                  if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
                    return bg;
                  }
                  current = current.parentElement;
                }
                return window.getComputedStyle(document.body).backgroundColor || 'rgb(255, 255, 255)';
              };

              return nodes
                .map((node) => {
                  const rect = node.getBoundingClientRect();
                  const style = window.getComputedStyle(node);
                  if (
                    rect.width <= 0 ||
                    rect.height <= 0 ||
                    style.display === 'none' ||
                    style.visibility === 'hidden'
                  ) {
                    return null;
                  }
                  return {
                    text: (node.innerText || node.textContent || '').trim().slice(0, 50),
                    fg: style.color,
                    bg: findBackground(node),
                  };
                })
                .filter(Boolean);
            }
            """,
        )

        if not samples:
            return context.result(
                check_id=check_id or slugify(title),
                title=title,
                category=VISUAL,
                status="skipped",
                summary="未找到可分析的前景/背景样本",
            )

        ratios = []
        harsh_pairs = []
        for sample in samples:
            ratio = _contrast_value(sample["fg"], sample["bg"])
            if ratio is None:
                continue
            ratios.append(round(ratio, 2))
            if _is_harsh_color_pair(sample["fg"], sample["bg"], ratio):
                harsh_pairs.append(sample["text"] or "<anonymous>")

        if not ratios:
            return context.result(
                check_id=check_id or slugify(title),
                title=title,
                category=VISUAL,
                status="skipped",
                summary="颜色样本不足，未能计算对比度",
            )

        min_found = min(ratios)
        passed = min_found >= min_ratio and len(harsh_pairs) <= allow_harsh_pairs
        details = [
            "最小对比度: {0}".format(min_found),
            "对比度序列: {0}".format(", ".join(str(item) for item in ratios[:8])),
        ]
        if harsh_pairs:
            details.append("疑似刺眼组合: {0}".format(", ".join(harsh_pairs[:5])))

        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=VISUAL,
            status="passed" if passed else "failed",
            summary="最小对比度 {0}，阈值 >= {1}".format(min_found, min_ratio),
            details=details,
            metrics={"min_ratio": min_found, "harsh_pairs": harsh_pairs},
        )

    return _make_check(title=title, category=VISUAL, executor=_executor, check_id=check_id)


def button_click(
    selector: str,
    expect_selector: Optional[str] = None,
    expect_url_contains: Optional[str] = None,
    title: str = "按钮响应检查",
    check_id: Optional[str] = None,
) -> AuditCheck:
    def _executor(context: Any):
        context.wait_for_visible(selector)
        context.page.locator(selector).first.click()
        if expect_selector:
            context.wait_for_visible(expect_selector)
        if expect_url_contains:
            _wait_for_url_contains(context.page, expect_url_contains, context.spec.timeout_ms)
        if not expect_selector and not expect_url_contains:
            context.page.wait_for_timeout(150)

        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=CONTROL,
            status="passed",
            summary="按钮 `{0}` 点击后响应正常".format(selector),
            metrics={"selector": selector},
        )

    return _make_check(title=title, category=CONTROL, executor=_executor, check_id=check_id)


def textbox_input(
    selector: str,
    value: str,
    expected_value: Optional[str] = None,
    title: str = "文本框输入检查",
    check_id: Optional[str] = None,
) -> AuditCheck:
    def _executor(context: Any):
        expected = value if expected_value is None else expected_value
        field = context.page.locator(selector).first
        field.wait_for(state="visible", timeout=context.spec.timeout_ms)
        field.fill(value)
        actual = field.input_value()
        passed = actual == expected
        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=CONTROL,
            status="passed" if passed else "failed",
            summary="输入值 `{0}`，实际值 `{1}`".format(expected, actual),
            metrics={"selector": selector, "expected_value": expected, "actual_value": actual},
        )

    return _make_check(title=title, category=CONTROL, executor=_executor, check_id=check_id)


def select_option(
    selector: str,
    value: Optional[str] = None,
    label: Optional[str] = None,
    expected_value: Optional[str] = None,
    title: str = "下拉框选择检查",
    check_id: Optional[str] = None,
) -> AuditCheck:
    def _executor(context: Any):
        target = context.page.locator(selector).first
        target.wait_for(state="visible", timeout=context.spec.timeout_ms)
        if label is not None:
            target.select_option(label=label)
        elif value is not None:
            target.select_option(value=value)
        else:
            raise ValueError("select_option 至少需要 value 或 label")

        actual = target.input_value()
        expected = expected_value or value or actual
        passed = actual == expected
        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=CONTROL,
            status="passed" if passed else "failed",
            summary="下拉值 `{0}`".format(actual),
            metrics={"selector": selector, "actual_value": actual, "expected_value": expected},
        )

    return _make_check(title=title, category=CONTROL, executor=_executor, check_id=check_id)


def radio_select(
    selector: str,
    title: str = "单选框响应检查",
    check_id: Optional[str] = None,
) -> AuditCheck:
    def _executor(context: Any):
        target = context.page.locator(selector).first
        target.wait_for(state="visible", timeout=context.spec.timeout_ms)
        target.check()
        passed = target.is_checked()
        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=CONTROL,
            status="passed" if passed else "failed",
            summary="单选框 `{0}` 已选中".format(selector),
            metrics={"selector": selector, "checked": passed},
        )

    return _make_check(title=title, category=CONTROL, executor=_executor, check_id=check_id)


def checkbox_toggle(
    selector: str,
    checked: bool = True,
    title: str = "复选框响应检查",
    check_id: Optional[str] = None,
) -> AuditCheck:
    def _executor(context: Any):
        target = context.page.locator(selector).first
        target.wait_for(state="visible", timeout=context.spec.timeout_ms)
        target.set_checked(checked)
        actual = target.is_checked()
        passed = actual == checked
        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=CONTROL,
            status="passed" if passed else "failed",
            summary="复选框目标状态 {0}，实际状态 {1}".format(checked, actual),
            metrics={"selector": selector, "expected": checked, "actual": actual},
        )

    return _make_check(title=title, category=CONTROL, executor=_executor, check_id=check_id)


def tab_order(
    expected_selectors: Sequence[str],
    start_selector: Optional[str] = None,
    title: str = "Tab 导航顺序",
    check_id: Optional[str] = None,
) -> AuditCheck:
    sequence = list(expected_selectors)

    def _executor(context: Any):
        if not sequence:
            return context.result(
                check_id=check_id or slugify(title),
                title=title,
                category=CONTROL,
                status="skipped",
                summary="未提供期望的 Tab 顺序",
            )

        if start_selector:
            starter = context.page.locator(start_selector).first
            starter.wait_for(state="visible", timeout=context.spec.timeout_ms)
            starter.focus()
        else:
            context.page.evaluate(
                """
                () => {
                  document.body.setAttribute('tabindex', '-1');
                  document.body.focus();
                }
                """
            )

        details = []
        passed = True
        for selector in sequence:
            context.page.keyboard.press("Tab")
            active = context.page.evaluate(
                """
                () => {
                  const node = document.activeElement;
                  if (!node) {
                    return { tag: '', id: '', name: '', text: '' };
                  }
                  return {
                    tag: node.tagName.toLowerCase(),
                    id: node.id || '',
                    name: node.getAttribute('name') || '',
                    text: (node.innerText || node.textContent || node.getAttribute('placeholder') || '').trim().slice(0, 30),
                  };
                }
                """
            )
            locator = context.page.locator(selector).first
            if locator.count() == 0:
                passed = False
                details.append("缺少预期焦点元素: {0}".format(selector))
                continue

            matched = locator.evaluate("node => node === document.activeElement")
            details.append("expect={0} actual={1}".format(selector, active))
            if not matched:
                passed = False

        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=CONTROL,
            status="passed" if passed else "failed",
            summary="Tab 顺序校验 {0} 个节点".format(len(sequence)),
            details=details,
        )

    return _make_check(title=title, category=CONTROL, executor=_executor, check_id=check_id)


def enter_triggers_default_button(
    focus_selector: str,
    expect_selector: Optional[str] = None,
    expect_url_contains: Optional[str] = None,
    title: str = "Enter 键触发默认按钮",
    check_id: Optional[str] = None,
) -> AuditCheck:
    def _executor(context: Any):
        if not expect_selector and not expect_url_contains:
            return context.result(
                check_id=check_id or slugify(title),
                title=title,
                category=CONTROL,
                status="skipped",
                summary="缺少 Enter 触发后的验证条件",
            )

        field = context.page.locator(focus_selector).first
        field.wait_for(state="visible", timeout=context.spec.timeout_ms)
        field.focus()
        context.page.keyboard.press("Enter")
        if expect_selector:
            context.wait_for_visible(expect_selector)
        if expect_url_contains:
            _wait_for_url_contains(context.page, expect_url_contains, context.spec.timeout_ms)

        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=CONTROL,
            status="passed",
            summary="Enter 键成功触发默认动作",
            metrics={"focus_selector": focus_selector},
        )

    return _make_check(title=title, category=CONTROL, executor=_executor, check_id=check_id)


def keyboard_shortcuts(
    shortcuts: Sequence[KeyboardShortcut],
    title: str = "快捷键有效性与冲突检查",
    check_id: Optional[str] = None,
) -> AuditCheck:
    items = list(shortcuts)

    def _normalize(keys: str) -> str:
        return "+".join(part.strip().lower() for part in keys.split("+"))

    def _executor(context: Any):
        normalized = [_normalize(item.keys) for item in items]
        duplicates = sorted(set(key for key in normalized if normalized.count(key) > 1))
        if duplicates:
            return context.result(
                check_id=check_id or slugify(title),
                title=title,
                category=CONTROL,
                status="failed",
                summary="存在重复快捷键: {0}".format(", ".join(duplicates)),
            )

        details = []
        for item in items:
            context.page.keyboard.press(item.keys)
            if item.expect_selector:
                context.wait_for_visible(item.expect_selector)
            if item.expect_active_selector:
                locator = context.page.locator(item.expect_active_selector).first
                locator.wait_for(state="visible", timeout=context.spec.timeout_ms)
                if locator.count() == 0:
                    raise AssertionError("未找到焦点目标: {0}".format(item.expect_active_selector))
                active_matched = locator.evaluate("node => node === document.activeElement")
                if not active_matched:
                    raise AssertionError("快捷键未将焦点移至: {0}".format(item.expect_active_selector))
            if item.expect_url_contains:
                _wait_for_url_contains(context.page, item.expect_url_contains, context.spec.timeout_ms)
            details.append("{0} -> {1}".format(item.keys, item.description or "ok"))

        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=CONTROL,
            status="passed",
            summary="快捷键数量 {0}，未发现声明级冲突".format(len(items)),
            details=details,
        )

    return _make_check(title=title, category=CONTROL, executor=_executor, check_id=check_id)


def text_quality(
    selector: str = "body",
    banned_patterns: Sequence[str] = ("\ufffd", "Ã", "Â", "ðŸ", "ï¿½"),
    title: str = "文字乱码与异常字符检查",
    check_id: Optional[str] = None,
) -> AuditCheck:
    patterns = list(banned_patterns)

    def _executor(context: Any):
        texts = context.page.locator(selector).all_inner_texts()
        content = "\n".join(item.strip() for item in texts if item.strip())
        if not content:
            return context.result(
                check_id=check_id or slugify(title),
                title=title,
                category=CONTENT,
                status="skipped",
                summary="目标区域没有可分析文本",
            )

        issues = []
        for token in patterns:
            if token and token in content:
                issues.append("命中异常片段: {0}".format(token))
        if re.search(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", content):
            issues.append("命中不可见控制字符")

        passed = not issues
        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=CONTENT,
            status="passed" if passed else "failed",
            summary="文本长度 {0}，异常项 {1}".format(len(content), len(issues)),
            details=issues,
            metrics={"selector": selector, "content_length": len(content)},
        )

    return _make_check(title=title, category=CONTENT, executor=_executor, check_id=check_id)


def terminology_guard(
    required_terms: Optional[Sequence[str]] = None,
    forbidden_terms: Optional[Sequence[str]] = None,
    selector: str = "body",
    title: str = "术语使用检查",
    check_id: Optional[str] = None,
) -> AuditCheck:
    required = list(required_terms or [])
    forbidden = list(forbidden_terms or [])

    def _executor(context: Any):
        texts = context.page.locator(selector).all_inner_texts()
        content = "\n".join(item.strip() for item in texts if item.strip())
        missing = [item for item in required if item not in content]
        present_forbidden = [item for item in forbidden if item in content]
        passed = not missing and not present_forbidden
        details = []
        if missing:
            details.append("缺少术语: {0}".format(", ".join(missing)))
        if present_forbidden:
            details.append("禁用术语: {0}".format(", ".join(present_forbidden)))

        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=CONTENT,
            status="passed" if passed else "failed",
            summary="缺少术语 {0} 个，禁用术语 {1} 个".format(len(missing), len(present_forbidden)),
            details=details,
        )

    return _make_check(title=title, category=CONTENT, executor=_executor, check_id=check_id)


def message_clarity(
    selector: str,
    min_length: int = 6,
    forbidden_phrases: Sequence[str] = ("系统异常", "操作失败", "未知错误"),
    required_keywords: Optional[Sequence[str]] = None,
    title: str = "提示文案清晰度",
    check_id: Optional[str] = None,
) -> AuditCheck:
    must_have = list(required_keywords or [])
    forbidden = list(forbidden_phrases)

    def _executor(context: Any):
        texts = [item.strip() for item in context.page.locator(selector).all_inner_texts() if item.strip()]
        if not texts:
            return context.result(
                check_id=check_id or slugify(title),
                title=title,
                category=CONTENT,
                status="skipped",
                summary="未找到提示文案",
            )

        unclear = []
        for text in texts:
            if len(text) < min_length:
                unclear.append("文案过短: {0}".format(text))
            if any(token in text for token in forbidden):
                unclear.append("文案过于模糊: {0}".format(text))
            if must_have and not any(token in text for token in must_have):
                unclear.append("缺少动作或指引信息: {0}".format(text))

        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=CONTENT,
            status="passed" if not unclear else "failed",
            summary="检查文案 {0} 条，问题 {1} 条".format(len(texts), len(unclear)),
            details=unclear,
        )

    return _make_check(title=title, category=CONTENT, executor=_executor, check_id=check_id)


def table_integrity(
    selector: str,
    require_scroll_or_pagination: bool = True,
    large_dataset_threshold: int = 5,
    title: str = "表格展示完整性",
    check_id: Optional[str] = None,
) -> AuditCheck:
    def _executor(context: Any):
        metrics = context.page.evaluate(
            """
            (args) => {
              const container = document.querySelector(args.selector);
              if (!container) {
                return { found: false };
              }
              const table = container.matches('table') ? container : container.querySelector('table');
              if (!table) {
                return { found: false };
              }

              const headers = Array.from(table.querySelectorAll('thead th'))
                .map((node) => (node.innerText || node.textContent || '').trim())
                .filter(Boolean);
              const rows = Array.from(table.querySelectorAll('tbody tr')).map((row) =>
                Array.from(row.children).map((cell) => (cell.innerText || cell.textContent || '').trim())
              );
              const rowCellCounts = rows.map((row) => row.length);
              const hasScroll =
                container.scrollWidth > container.clientWidth + 1 ||
                container.scrollHeight > container.clientHeight + 1;
              const hasPagination = Boolean(
                document.querySelector('.pagination, .pager, [data-testid="pagination"], [aria-label*="pagination"]')
              );

              return {
                found: true,
                headers,
                rowCount: rows.length,
                rowCellCounts,
                hasScroll,
                hasPagination,
              };
            }
            """,
            {"selector": selector},
        )

        if not metrics.get("found"):
            return context.result(
                check_id=check_id or slugify(title),
                title=title,
                category=CONTENT,
                status="failed",
                summary="未找到表格容器: {0}".format(selector),
            )

        headers = metrics["headers"]
        row_count = metrics["rowCount"]
        row_cell_counts = metrics["rowCellCounts"]
        inconsistent_rows = [count for count in row_cell_counts if headers and count != len(headers)]
        missing_structure = not headers or row_count == 0
        lacks_large_data_support = (
            require_scroll_or_pagination
            and row_count >= large_dataset_threshold
            and not metrics["hasScroll"]
            and not metrics["hasPagination"]
        )
        passed = not missing_structure and not inconsistent_rows and not lacks_large_data_support
        details = [
            "headers={0}".format(headers),
            "rows={0}, cell_counts={1}".format(row_count, row_cell_counts),
            "scroll={0}, pagination={1}".format(metrics["hasScroll"], metrics["hasPagination"]),
        ]

        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=CONTENT,
            status="passed" if passed else "failed",
            summary="表头 {0} 列，数据 {1} 行".format(len(headers), row_count),
            details=details,
            metrics={
                "header_count": len(headers),
                "row_count": row_count,
                "has_scroll": metrics["hasScroll"],
                "has_pagination": metrics["hasPagination"],
            },
        )

    return _make_check(title=title, category=CONTENT, executor=_executor, check_id=check_id)


def navigation_flow(
    steps: Sequence[NavigationStep],
    title: str = "页面跳转与返回逻辑",
    check_id: Optional[str] = None,
) -> AuditCheck:
    journey = list(steps)

    def _executor(context: Any):
        if not journey:
            return context.result(
                check_id=check_id or slugify(title),
                title=title,
                category=NAVIGATION,
                status="skipped",
                summary="未定义导航步骤",
            )

        details = []
        for step in journey:
            previous_url = context.current_url()
            context.wait_for_visible(step.action_selector)
            context.page.locator(step.action_selector).first.click()
            if step.expected_selector:
                context.wait_for_visible(step.expected_selector)
            if step.expected_url_contains:
                _wait_for_url_contains(context.page, step.expected_url_contains, context.spec.timeout_ms)
            details.append("{0}: {1}".format(step.name, context.current_url()))

            if step.go_back:
                context.page.go_back(wait_until=context.spec.wait_until, timeout=context.spec.timeout_ms)
                if step.back_expected_selector:
                    context.wait_for_visible(step.back_expected_selector)
                elif step.back_expected_url_contains:
                    _wait_for_url_contains(context.page, step.back_expected_url_contains, context.spec.timeout_ms)
                else:
                    _wait_for_url_contains(context.page, previous_url, context.spec.timeout_ms)
                details.append("{0} <- back".format(step.name))

        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=NAVIGATION,
            status="passed",
            summary="导航步骤 {0} 个全部通过".format(len(journey)),
            details=details,
        )

    return _make_check(title=title, category=NAVIGATION, executor=_executor, check_id=check_id)


def menu_depth(
    selector: str,
    max_depth: int = 3,
    title: str = "导航菜单层级限制",
    check_id: Optional[str] = None,
) -> AuditCheck:
    def _executor(context: Any):
        metrics = context.page.evaluate(
            """
            (selector) => {
              const root = document.querySelector(selector);
              if (!root) {
                return { found: false };
              }
              const nodes = Array.from(root.querySelectorAll('li, [role="menuitem"], a, button'));
              const depths = nodes.map((node) => {
                const ariaLevel = Number(node.getAttribute('aria-level') || 0);
                if (ariaLevel > 0) {
                  return ariaLevel;
                }
                let depth = 1;
                let current = node.parentElement;
                while (current && current !== root) {
                  const role = current.getAttribute('role');
                  if (
                    current.tagName === 'UL' ||
                    current.tagName === 'OL' ||
                    current.tagName === 'NAV' ||
                    role === 'menu' ||
                    role === 'group'
                  ) {
                    depth += 1;
                  }
                  current = current.parentElement;
                }
                return depth;
              });
              return {
                found: true,
                maxDepth: depths.length ? Math.max(...depths) : 0,
                itemCount: depths.length,
              };
            }
            """,
            selector,
        )

        if not metrics.get("found"):
            return context.result(
                check_id=check_id or slugify(title),
                title=title,
                category=NAVIGATION,
                status="failed",
                summary="未找到导航容器: {0}".format(selector),
            )

        passed = metrics["maxDepth"] <= max_depth
        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=NAVIGATION,
            status="passed" if passed else "failed",
            summary="菜单最大层级 {0}，阈值 <= {1}".format(metrics["maxDepth"], max_depth),
            metrics={"item_count": metrics["itemCount"], "max_depth": metrics["maxDepth"]},
        )

    return _make_check(title=title, category=NAVIGATION, executor=_executor, check_id=check_id)


def step_flow_status(
    step_selector: str,
    current_selector: Optional[str] = None,
    restriction_selector: Optional[str] = None,
    min_steps: int = 2,
    title: str = "多步骤流程状态提示",
    check_id: Optional[str] = None,
) -> AuditCheck:
    def _executor(context: Any):
        labels = [item.strip() for item in context.page.locator(step_selector).all_inner_texts() if item.strip()]
        current_visible = True
        restriction_visible = True
        if current_selector:
            current_visible = context.page.locator(current_selector).first.is_visible()
        if restriction_selector:
            restriction_visible = context.page.locator(restriction_selector).first.is_visible()

        passed = len(labels) >= min_steps and current_visible and restriction_visible
        details = ["steps={0}".format(labels)]
        if current_selector:
            details.append("current_visible={0}".format(current_visible))
        if restriction_selector:
            details.append("restriction_visible={0}".format(restriction_visible))

        return context.result(
            check_id=check_id or slugify(title),
            title=title,
            category=NAVIGATION,
            status="passed" if passed else "failed",
            summary="流程步骤 {0} 个".format(len(labels)),
            details=details,
        )

    return _make_check(title=title, category=NAVIGATION, executor=_executor, check_id=check_id)
