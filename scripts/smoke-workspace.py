"""Browser smoke test against an isolated Lilium library (`pip install playwright`)."""

import argparse
import os
import re
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def png(width, height, tone):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    rows = [b"\0" + bytes(channel for x in range(width) for channel in
                            ((x + tone) % 256, (y * 2 + tone) % 256, (tone + (x ^ y)) % 256))
            for y in range(height)]
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">2I5B", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"".join(rows))) + chunk(b"IEND", b""))


def wait_until_ready(server, url):
    for _ in range(50):
        if server.poll() is not None:
            raise RuntimeError("Lilium exited before starting")
        try:
            with urllib.request.urlopen(f"{url}/api/info", timeout=0.2) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            time.sleep(0.1)
    raise RuntimeError("Lilium did not start")


def check_no_overflow(page):
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth"), "document overflows viewport"
    assert page.locator(".workspace-controls").evaluate("el => el.scrollWidth <= el.clientWidth"), "toolbar overflows"


def exercise(browser, url, screenshots):
    desktop = browser.new_page(viewport={"width": 1440, "height": 900}, locale="zh-CN", reduced_motion="reduce")
    errors = []
    desktop.on("pageerror", lambda error: errors.append(str(error)))

    def capture(page, name):
        if screenshots:
            page.screenshot(path=str(screenshots / f"{name}.png"))

    desktop.goto(url)
    expect(desktop.get_by_role("heading", name="从第一份素材开始")).to_be_visible()
    check_no_overflow(desktop)
    capture(desktop, "empty-desktop")

    desktop.get_by_role("button", name="导入素材").click()
    import_menu = desktop.get_by_role("dialog", name="导入方式")
    expect(import_menu).to_be_visible()
    assert import_menu.get_by_role("button", name="从文件夹导入…").count() == 1
    import_menu.get_by_role("button", name="从文件夹导入…").click()
    import_dialog = desktop.get_by_role("dialog", name="磁盘导入")
    expect(import_dialog).to_be_visible()
    assert import_dialog.get_by_role("button", name="选择文件夹…").count() == 0, "web build must hide native folder picker"
    expect(import_dialog.get_by_text(re.compile("浏览器无法直接读取本机目录"))).to_be_visible()
    import_dialog.get_by_role("button", name="关闭弹窗").click()
    expect(import_dialog).not_to_be_visible()
    desktop.get_by_role("button", name="导入素材").click()
    with desktop.expect_file_chooser() as picker:
        desktop.get_by_role("button", name="选择文件…").click()
    picker.value.set_files([
        {"name": name, "mimeType": "image/png", "buffer": png(w, h, tone)}
        for name, w, h, tone in [("aurora.png", 200, 120, 50), ("flora.png", 120, 200, 90), ("night.png", 175, 148, 155)]
    ])
    expect(desktop.locator(".workspace-heading .count-badge")).to_have_text("3 项")
    expect(desktop.locator(".canvas-infinite .asset-thumb img.is-ready").first).to_be_visible()
    canvas = desktop.get_by_role("group", name="画布控制")
    zoom = canvas.locator("output")
    initial = zoom.inner_text()
    canvas.get_by_role("button", name="放大画布").click()
    assert zoom.inner_text() != initial
    canvas.get_by_role("button", name="重置画布").click()
    expect(zoom).to_have_text(initial)

    box = desktop.locator(".canvas-infinite .canvas-viewport").bounding_box()
    assert box
    desktop.keyboard.down("Shift")
    desktop.mouse.move(box["x"] + 25, box["y"] + 25)
    desktop.mouse.down()
    desktop.mouse.move(box["x"] + box["width"] - 25, box["y"] + box["height"] - 95, steps=8)
    desktop.mouse.up()
    desktop.keyboard.up("Shift")
    expect(desktop.locator(".selection-count")).to_have_text("已选 3 项")
    desktop.keyboard.press("Escape")
    expect(desktop.locator(".selection-dock")).not_to_be_visible()
    capture(desktop, "infinite-desktop")

    desktop.keyboard.press("2")
    aurora = desktop.get_by_role("button", name=re.compile("^aurora"))
    expect(aurora).to_be_visible()
    aurora.click()
    desktop.get_by_role("button", name="查看详情").click()
    detail = desktop.get_by_role("complementary", name="详情")
    expect(detail).to_have_count(1)
    cover = detail.locator(".detail-cover img.is-ready")
    expect(cover).to_be_visible()
    assert cover.evaluate("el => el.clientWidth > 150 && el.naturalWidth > 0"), "detail cover is clipped"
    detail.get_by_role("textbox", name=re.compile("注释")).fill("极光图片测试注释")
    detail.get_by_role("textbox", name=re.compile("来源链接")).fill("https://example.invalid/aurora")
    detail.get_by_role("textbox", name=re.compile("来源链接")).press("Tab")
    expect(detail.get_by_role("link", name="打开来源链接")).to_have_attribute("href", "https://example.invalid/aurora")
    detail.get_by_role("textbox", name="添加标签").fill("灵感")
    detail.get_by_role("button", name="保存标签").click()
    expect(detail.get_by_role("button", name="移除标签 灵感")).to_be_visible()
    detail.locator(".detail-scroll").evaluate("el => el.scrollTop = 0")
    capture(desktop, "detail-desktop")

    detail.get_by_role("button", name="打开大图预览").click()
    lightbox = desktop.get_by_role("dialog", name="大图预览")
    expect(lightbox).to_be_visible()
    desktop.keyboard.press("4")
    expect(lightbox.get_by_role("button", name="评为 4 星")).to_have_attribute("aria-pressed", "true")
    expect(desktop.get_by_role("button", name="网格", include_hidden=True)).to_have_attribute("aria-pressed", "true")
    lightbox.get_by_role("button", name="放大预览").click()
    expect(lightbox.locator("output")).to_have_text("125%")
    capture(desktop, "preview-desktop")
    desktop.keyboard.press("Escape")
    expect(lightbox).not_to_be_visible()
    detail.get_by_role("button", name="关闭详情").click()

    desktop.get_by_role("button", name="列表", exact=True).click()
    expect(desktop.locator(".asset-list-row")).to_have_count(3)
    head = desktop.locator(".asset-list-head").bounding_box()
    row = desktop.locator(".asset-list-row").first.bounding_box()
    assert head and row and row["y"] >= head["y"] + head["height"], "first row is covered by the header"
    desktop.get_by_role("button", name="高级筛选").click()
    filters = desktop.get_by_role("dialog", name="高级筛选")
    filters.get_by_label("最低评分").select_option("4")
    expect(desktop.locator(".asset-list-row")).to_have_count(3)
    filters.get_by_label("最高评分").select_option("3")
    expect(filters.get_by_role("button", name=re.compile("应用筛选"))).to_be_disabled()
    filters.get_by_label("最高评分").select_option("0")
    filters.get_by_role("button", name=re.compile("应用筛选")).click()
    expect(desktop.locator(".asset-list-row")).to_have_count(1)
    expect(aurora).to_be_visible()
    desktop.get_by_role("button", name="保存当前筛选", exact=True).first.click()
    smart = desktop.get_by_role("dialog", name="保存为智能文件夹")
    smart.get_by_role("textbox", name="名称").fill("高分收藏")
    smart.get_by_role("button", name="保存", exact=True).click()
    expect(smart).not_to_be_visible()
    desktop.get_by_role("button", name="移除筛选：≥ 4 星").click()
    expect(desktop.locator(".asset-list-row")).to_have_count(3)
    desktop.get_by_role("button", name="高分收藏", exact=True).click()
    expect(desktop.locator(".asset-list-row")).to_have_count(1)

    desktop.get_by_role("button", name="全部素材", exact=True).click()
    desktop.keyboard.press("Control+f")
    search = desktop.get_by_role("searchbox", name="搜索素材")
    expect(search).to_be_focused()
    queries = []
    desktop.on("request", lambda request: queries.append(request.url) if "/api/items?" in request.url and "q=" in request.url else None)
    search.press_sequentially("not-found", delay=35)
    expect(desktop.get_by_role("heading", name="没有匹配的素材")).to_be_visible()
    assert len(queries) == 1, f"Expected one debounced search, got {queries}"
    desktop.keyboard.press("Escape")
    expect(desktop.locator(".asset-list-row")).to_have_count(3)
    aurora.click(button="right")
    desktop.get_by_role("dialog", name="素材操作").get_by_role("button", name="查找相似素材").click()
    expect(desktop.get_by_role("heading", name="相似素材")).to_be_visible()
    desktop.get_by_role("button", name="退出相似搜索").click()
    expect(desktop.locator(".asset-list-row")).to_have_count(3)

    desktop.get_by_role("button", name="新建文件夹", exact=True).first.click()
    folder = desktop.get_by_role("dialog", name="新建文件夹")
    folder.get_by_role("textbox", name="名称").fill("灵感收集")
    folder.get_by_role("button", name="保存", exact=True).click()
    expect(folder).not_to_be_visible()
    desktop.get_by_role("button", name="分类墙", exact=True).click()
    collection = desktop.get_by_role("button", name="打开文件夹 灵感收集")
    expect(collection).to_be_visible()
    collection.click()
    expect(desktop.locator(".canvas-controls output")).to_have_text("130%")
    collection.click()
    expect(desktop.get_by_role("heading", name="这个文件夹还没有素材")).to_be_visible()
    desktop.get_by_role("button", name="全部素材", exact=True).click()
    expect(aurora).to_be_visible()

    items_path = re.compile(r"/api/items\?")
    desktop.route(items_path, lambda route: route.fulfill(status=503, json={"error": "test unavailable"}))
    desktop.get_by_role("button", name="更多工具").click()
    desktop.get_by_role("button", name="刷新资源库").click()
    expect(desktop.get_by_role("heading", name="无法载入素材")).to_be_visible()
    desktop.unroute(items_path)
    desktop.get_by_role("button", name="重新加载").click()
    expect(aurora).to_be_visible()

    search.focus()
    desktop.keyboard.press("Control+k")
    palette = desktop.get_by_role("dialog", name="命令面板")
    command = palette.get_by_role("combobox", name="搜索命令")
    expect(command).to_be_focused()
    capture(desktop, "commands-desktop")
    command.press("ArrowUp")
    shortcut = palette.get_by_role("option", name=re.compile("查看键盘快捷键"))
    expect(shortcut).to_have_attribute("aria-selected", "true")
    expect(shortcut).to_be_in_viewport()
    command.fill("nothing-matches")
    expect(palette.get_by_text("没有匹配的操作")).to_be_visible()
    command.press("ArrowDown")
    command.press("Enter")
    expect(palette).to_be_visible()
    command.fill("搜索素材")
    command.press("Enter")
    expect(palette).not_to_be_visible()
    expect(search).to_be_focused()

    desktop.get_by_role("button", name="分类墙", exact=True).click()
    desktop.get_by_role("button", name="打开命令面板").click()
    command.fill("filter")
    command.press("Enter")
    expect(desktop.get_by_role("button", name="瀑布流", exact=True)).to_have_attribute("aria-pressed", "true")
    expect(filters).to_be_visible()
    filters.get_by_role("button", name="关闭筛选").click()

    desktop.keyboard.press("Control+k")
    command.fill("导入本地文件")
    with desktop.expect_file_chooser() as command_picker:
        command.press("Enter")
    command_picker.value.set_files([])
    expect(palette).not_to_be_visible()
    desktop.keyboard.press("Control+k")
    command.fill("view")
    command.press("ArrowDown")
    grid_option = palette.get_by_role("option", name=re.compile("切换到网格"))
    expect(grid_option).to_have_attribute("aria-selected", "true")
    expect(command).to_have_attribute("aria-activedescendant", grid_option.get_attribute("id"))
    command.press("Enter")
    expect(desktop.get_by_role("button", name="网格", exact=True)).to_have_attribute("aria-pressed", "true")

    desktop.get_by_role("button", name="缩略图大小").click()
    slider = desktop.get_by_role("slider", name="缩略图大小")
    slider.press("End")
    expect(slider).to_have_value("420")
    desktop.keyboard.press("Escape")

    desktop.get_by_role("button", name="无限视图", exact=True).click()
    toggle = desktop.get_by_role("button", name="多选素材")
    toggle.click()
    picks = desktop.locator(".canvas-infinite .canvas-viewport").evaluate("""canvas => {
      const bounds = canvas.getBoundingClientRect();
      const points = new Map();
      for (const tile of canvas.querySelectorAll('[data-tile]')) {
        const box = tile.getBoundingClientRect();
        const x = (Math.max(box.left, bounds.left + 5) + Math.min(box.right, bounds.right - 5)) / 2;
        const y = (Math.max(box.top, bounds.top + 5) + Math.min(box.bottom, bounds.bottom - 95)) / 2;
        if (document.elementFromPoint(x, y)?.closest('[data-tile]') === tile) points.set(tile.dataset.tile, [x, y]);
      }
      return [...points.values()].slice(0, 2);
    }""")
    assert len(picks) == 2
    for x, y in picks:
        desktop.mouse.click(x, y)
    expect(desktop.locator(".selection-count")).to_have_text("已选 2 项")
    expect(desktop.get_by_role("dialog", name="大图预览")).not_to_be_visible()
    desktop.keyboard.press("Escape")
    expect(toggle).to_have_attribute("aria-pressed", "false")
    desktop.get_by_role("button", name="网格", exact=True).click()
    desktop.get_by_role("button", name="排序方式").click()
    sort_menu = desktop.get_by_role("dialog", name="排序方式")
    sort_menu.get_by_label("排序字段").select_option("name")
    sort_menu.get_by_role("button", name="升序", exact=True).click()
    expect(desktop.locator(".grid-asset").first).to_have_attribute("aria-label", "aurora.png")
    search.fill("flora")
    expect(desktop.locator(".grid-asset")).to_have_count(1)
    desktop.reload()
    expect(desktop.get_by_role("button", name="网格", exact=True)).to_have_attribute("aria-pressed", "true")
    expect(desktop.locator(".grid-asset")).to_have_count(3)
    expect(desktop.locator(".grid-asset").first).to_have_attribute("aria-label", "aurora.png")
    expect(search).to_have_value("")
    desktop.get_by_role("button", name="排序方式").click()
    expect(sort_menu.get_by_label("排序字段")).to_have_value("name")
    expect(sort_menu.get_by_role("button", name="升序", exact=True)).to_have_attribute("aria-pressed", "true")
    desktop.keyboard.press("Escape")
    desktop.get_by_role("button", name="缩略图大小").click()
    expect(slider).to_have_value("420")
    desktop.keyboard.press("Escape")

    mobile = browser.new_page(viewport={"width": 360, "height": 740}, locale="zh-CN", is_mobile=True,
                              has_touch=True, device_scale_factor=1, reduced_motion="reduce")
    mobile.on("pageerror", lambda error: errors.append(str(error)))
    mobile.goto(url)
    expect(mobile.locator(".workspace-heading .count-badge")).to_have_text("3 项")
    check_no_overflow(mobile)
    mobile.get_by_role("button", name="展开侧栏").click()
    nav = mobile.get_by_role("dialog", name="素材库导航")
    expect(nav).to_be_visible()
    nav.get_by_role("button", name="管理资源库").click()
    lib = nav.get_by_role("dialog", name="资源库管理")
    expect(lib).to_be_visible()
    mobile.keyboard.press("Escape")
    expect(lib).not_to_be_visible()
    expect(nav).to_be_visible()
    nav.get_by_role("button", name="回收站", exact=True).click()
    expect(nav).not_to_be_visible()
    expect(mobile.get_by_role("heading", name="回收站是空的")).to_be_visible()
    mobile.get_by_role("button", name="返回素材库", exact=True).click()
    mobile.get_by_role("button", name="网格", exact=True).click()
    expect(mobile.locator(".grid-asset")).to_have_count(3)
    check_no_overflow(mobile)
    capture(mobile, "grid-mobile")
    mobile.get_by_role("button", name="高级筛选").click()
    mobile_filters = mobile.get_by_role("dialog", name="高级筛选")
    expect(mobile_filters).to_be_visible()
    assert mobile_filters.evaluate("el => el.scrollWidth === el.clientWidth"), "filter form overflows"
    expect(mobile_filters.get_by_role("button", name="应用筛选", exact=True)).to_be_in_viewport()
    capture(mobile, "filters-mobile")
    mobile_filters.get_by_role("button", name="关闭筛选").click()
    mobile.get_by_role("button", name=re.compile("^aurora")).click()
    mobile.get_by_role("button", name="查看详情").click()
    expect(mobile.get_by_role("dialog", name="素材详情")).to_be_visible()
    mobile.keyboard.press("Escape")
    expect(mobile.get_by_role("dialog", name="素材详情")).not_to_be_visible()
    mobile.set_viewport_size({"width": 320, "height": 640})
    check_no_overflow(mobile)
    assert mobile.locator(".workspace-heading h1").evaluate("el => el.scrollWidth <= el.clientWidth"), "heading is clipped"
    assert mobile.locator(".workspace-controls").evaluate("el => el.scrollWidth <= el.clientWidth"), "controls overflow at 320px"

    mobile.get_by_role("button", name="更多工具").tap()
    mobile.get_by_role("dialog", name="更多工具").get_by_role("button", name=re.compile("打开命令面板")).tap()
    mobile_palette = mobile.get_by_role("dialog", name="命令面板")
    expect(mobile_palette).to_be_visible()
    assert mobile_palette.evaluate("el => el.scrollWidth <= el.clientWidth"), "command panel overflows"
    capture(mobile, "commands-mobile")
    mobile_palette.get_by_role("button", name="关闭命令面板").tap()

    mobile.get_by_role("button", name="取消选择").tap()
    select_mode = mobile.locator(".selection-toggle")
    select_mode.tap()
    expect(select_mode).to_have_attribute("aria-pressed", "true")
    expect(mobile.get_by_text("点按素材以选择")).to_be_visible()
    expect(mobile.locator('.grid-asset .asset-check[data-selected="false"]').first).to_be_visible()
    mobile_aurora = mobile.get_by_role("button", name="aurora.png", exact=True)
    mobile_flora = mobile.get_by_role("button", name="flora.png", exact=True)
    mobile_aurora.tap()
    mobile_flora.tap()
    expect(mobile.locator(".selection-count")).to_have_text("已选 2 项")
    assets = mobile.request.get(f"{url}/api/items").json()["items"]
    selected_bytes = sum(item["size"] for item in assets if item["name"] in {"aurora.png", "flora.png"})
    expect(mobile.locator(".selection-size")).to_have_text(f"{selected_bytes / 1024:.1f} KB")
    for summary in [".selection-count", ".selection-size"]:
        assert mobile.locator(summary).evaluate("el => el.scrollWidth <= el.clientWidth + 1"), "selection summary is clipped"
    capture(mobile, "selection-mobile")
    mobile.get_by_role("button", name="列表", exact=True).tap()
    expect(mobile_aurora).to_have_attribute("aria-pressed", "true")
    mobile_aurora.tap()
    expect(mobile.locator(".selection-count")).to_have_text("已选 1 项")
    expect(mobile.get_by_role("dialog", name="大图预览")).not_to_be_visible()
    mobile.keyboard.press("Escape")
    expect(select_mode).to_have_attribute("aria-pressed", "false")
    expect(mobile.locator(".selection-dock")).not_to_be_visible()

    assert not errors, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    server_path = ROOT / "target/debug" / ("lilium-server.exe" if os.name == "nt" else "lilium-server")
    if not server_path.is_file() or not (ROOT / "web/dist/index.html").is_file():
        parser.error("Build with `cargo build -p lilium-server --bin lilium-server` and `npm --prefix web run build` first.")

    with tempfile.TemporaryDirectory(prefix="lilium-smoke-") as work, socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        listener.close()
        url = f"http://127.0.0.1:{port}"
        with subprocess.Popen([str(server_path), "--port", str(port), "--library", str(Path(work) / "Smoke.lilium"),
                               "--dist", str(ROOT / "web/dist")],
                              env={**os.environ, "HOME": work, "USERPROFILE": work, "XDG_CONFIG_HOME": work, "XDG_DATA_HOME": work},
                              stdout=subprocess.DEVNULL) as server:
            try:
                wait_until_ready(server, url)
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(executable_path=os.environ.get("LILIUM_CHROMIUM") or shutil.which("chromium"))
                    try:
                        exercise(browser, url, args.screenshots)
                    finally:
                        browser.close()
            finally:
                server.terminate()
                server.wait(timeout=10)
    print("Workspace smoke tests passed (desktop + mobile).")


if __name__ == "__main__":
    main()
