#!/usr/bin/env python3
"""扫描目录下所有研报 .md/.html 文件，自动生成 files.json 清单"""

import re
import json
import os
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).parent

# 不纳入清单的文件（配置类）
SKIP = {
    "README.md", "CLOUDFLARE_SETUP.md", "index.html", "_headers",
    ".gitignore", "gen_files.py"
}

# 关键词 → 标签映射
TAG_MAP = [
    (["戴尔", "DELL", "dell"], "戴尔"),
    (["Anthropic", "anthropic", "anthropic"], "Anthropic"),
    (["卖方", "券商", "晨会"], "券商晨会"),
    (["特朗普", "trump", "Trump"], "特朗普"),
    (["AI", "算力", "服务器", "GPU", "TPU", "光模块", "PCB"], "AI算力"),
    (["持仓", "盈亏"], "持仓分析"),
    (["概念", "受益", "产业链"], "概念股"),
    (["个股", "梳理"], "个股梳理"),
]

def extract_title(filepath):
    """从 MD/HTML 文件中提取标题"""
    try:
        content = filepath.read_text(encoding="utf-8")
        # MD: 找第一个 # 标题
        m = re.search(r"^#\s+(.+)", content, re.MULTILINE)
        if m:
            return m.group(1).strip()
        # HTML: 找 <title> 或第一个 <h1>
        m = re.search(r"<title>(.+?)</title>", content, re.IGNORECASE)
        if m:
            return m.group(1).strip()
        m = re.search(r"<h1[^>]*>(.+?)</h1>", content, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    except Exception:
        pass
    return filepath.stem

def extract_date(filepath):
    """从文件名中提取日期 (YYYY-MM-DD)，失败则用文件修改时间"""
    filename = filepath.name
    # 优先匹配标准日期格式
    m = re.search(r"(\d{4}-\d{2}-\d{2})", filename)
    if m:
        return m.group(1)
    # 兜底：文件修改时间
    ts = filepath.stat().st_mtime
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")

def extract_desc(filepath):
    """从文件中提取简短描述（前 100 个有效字符）"""
    try:
        content = filepath.read_text(encoding="utf-8")
        suffix = filepath.suffix.lower()
        if suffix == ".md":
            # 跳过标题行和空行，取第一个非空段落
            lines = content.split("\n")
            in_text = False
            for line in lines:
                stripped = line.strip()
                if not stripped or stripped.startswith("#") or stripped.startswith(">"):
                    continue
                if stripped.startswith("---"):
                    continue
                if len(stripped) > 20 and not stripped.startswith("|"):
                    return stripped[:100].rstrip("。，、；：！？") + "…"
                if len(stripped) > 10:
                    return stripped[:100].rstrip("。，、；：！？") + "…"
        elif suffix == ".html":
            # 找 meta description 或第一个有内容的 p
            m = re.search(r'<meta\s+name="description"\s+content="(.+?)"', content, re.IGNORECASE)
            if m:
                return m.group(1)[:100]
            m = re.search(r"<p[^>]*>(.+?)</p>", content, re.IGNORECASE)
            if m:
                text = re.sub(r"<[^>]+>", "", m.group(1)).strip()
                if len(text) > 20:
                    return text[:100].rstrip("。，、；：！？") + "…"
    except Exception:
        pass
    return ""

def auto_tags(title, desc, filename):
    """根据标题、描述、文件名自动生成标签"""
    combined = f"{title} {desc} {filename}".lower()
    tags = []
    for keywords, tag in TAG_MAP:
        for kw in keywords:
            if kw.lower() in combined:
                if tag not in tags:
                    tags.append(tag)
                break
    return tags

def scan():
    items = []
    for f in sorted(ROOT.iterdir()):
        if not f.is_file():
            continue
        if f.name in SKIP:
            continue
        suffix = f.suffix.lower()
        if suffix not in (".md", ".html"):
            continue

        title = extract_title(f)
        date = extract_date(f)
        desc = extract_desc(f)
        tags = auto_tags(title, desc, f.name)
        ftype = suffix.lstrip(".")

        items.append({
            "filename": f.name,
            "title": title,
            "date": date,
            "desc": desc or f"{title}",
            "tags": tags,
            "type": ftype,
            "href": f.name
        })

    return items

def main():
    items = scan()

    # 去重：同一个主题的 md+html 合并为一个条目
    merged = {}
    for item in items:
        # 用文件名去掉扩展名的部分作为 key
        base = re.sub(r"\.(md|html)$", "", item["filename"], flags=re.IGNORECASE)
        if base not in merged:
            merged[base] = {
                "title": item["title"],
                "date": item["date"],
                "desc": item["desc"],
                "tags": item["tags"],
                "files": []
            }
        merged[base]["files"].append({
            "name": item["type"].upper(),
            "href": item["href"],
            "type": item["type"]
        })
        # 取更长的标题/描述
        if len(item["title"]) > len(merged[base]["title"]):
            merged[base]["title"] = item["title"]
        if len(item["desc"]) > len(merged[base]["desc"]):
            merged[base]["desc"] = item["desc"]
        if len(item["tags"]) > len(merged[base]["tags"]):
            merged[base]["tags"] = item["tags"]
        if item["date"] and not merged[base]["date"]:
            merged[base]["date"] = item["date"]

    result = list(merged.values())

    # 按日期倒序
    result.sort(key=lambda x: x["date"], reverse=True)

    output_path = ROOT / "files.json"
    output_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"[OK] 扫描完成，共 {len(result)} 个文档条目 → {output_path}")
    for item in result:
        ftypes = "/".join(f["name"] for f in item["files"])
        print(f"  📄 {item['title']}  [{ftypes}]  {item['date']}")

if __name__ == "__main__":
    main()
