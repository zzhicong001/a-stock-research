#!/usr/bin/env python3
"""
将 bazi_final.docx 转换为 EPUB 格式，针对 iPhone 图书 App 阅读优化。
- 按标题层级拆分章节
- 嵌入所有图片
- 中文移动端排版优化
- 层级目录导航
"""

import os, sys, re, io, shutil, zipfile
from pathlib import Path
from collections import OrderedDict
from lxml import etree
import docx
from docx.opc.constants import RELATIONSHIP_TYPE as RT
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

# ── 配置 ──────────────────────────────────────────
DOCX_PATH = r"C:/Users/Administrator/Desktop/bazi_final.docx"
OUTPUT_EPUB = r"H:/buddy/华山八字教学总集.epub"
WORK_DIR = Path(r"H:/buddy/epub_build")
TITLE = "华山八字教学总集"
AUTHOR = "老陈说易"
LANGUAGE = "zh"

# ── CSS（iPhone 图书 App 优化） ──────────────────
CSS = """
/* ── iPhone 图书 App 阅读优化 ── */
@namespace epub "http://www.idpf.org/2007/ops";

body {
    font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    font-size: 1.05em;
    line-height: 1.85;
    color: #1a1a1a;
    margin: 0;
    padding: 0.6em 0.8em;
    text-align: justify;
    word-break: break-all;
}

/* 标题样式 - 适合手机屏幕 */
h1 {
    font-size: 1.6em;
    font-weight: 700;
    color: #8B0000;
    text-align: center;
    margin: 1.2em 0 0.6em 0;
    padding-bottom: 0.3em;
    border-bottom: 2px solid #8B0000;
    line-height: 1.3;
}

h2 {
    font-size: 1.3em;
    font-weight: 600;
    color: #333;
    margin: 1em 0 0.4em 0;
    padding: 0.2em 0;
    border-left: 4px solid #8B0000;
    padding-left: 0.5em;
    line-height: 1.35;
}

h3 {
    font-size: 1.15em;
    font-weight: 600;
    color: #444;
    margin: 0.8em 0 0.3em 0;
    line-height: 1.35;
}

h4 {
    font-size: 1.05em;
    font-weight: 600;
    color: #555;
    margin: 0.7em 0 0.3em 0;
}

p {
    margin: 0.4em 0;
    text-indent: 1.6em;
}

/* 首段不缩进 */
p.no-indent {
    text-indent: 0;
}

/* 分隔线 */
.separator {
    text-align: center;
    color: #999;
    margin: 1em 0;
    letter-spacing: 0.5em;
    text-indent: 0;
    font-size: 0.9em;
}

/* 原文链接 */
.source-link {
    font-size: 0.8em;
    color: #888;
    text-indent: 0;
    word-break: break-all;
}

/* 目录项 */
.toc-item { text-indent: 0; margin: 0.3em 0; }
.toc-h1 { font-weight: 700; font-size: 1.1em; color: #8B0000; }
.toc-h2 { padding-left: 1.2em; color: #333; }

/* 图片 - 手机适配 */
img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 0.6em auto;
    border-radius: 4px;
}

.figure-caption {
    text-align: center;
    font-size: 0.85em;
    color: #777;
    text-indent: 0;
    margin-top: 0.2em;
}

/* 强调 */
em { font-style: italic; color: #555; }
strong { color: #222; }

/* 代码/特殊标记 */
code {
    font-family: "Courier New", monospace;
    background: #f5f5f5;
    padding: 0.1em 0.3em;
    border-radius: 3px;
    font-size: 0.9em;
}

/* 夜间模式兼容 */
@media (prefers-color-scheme: dark) {
    body { color: #ddd; background: #1a1a1a; }
    h1 { color: #ff6b6b; border-bottom-color: #ff6b6b; }
    h2 { color: #ccc; border-left-color: #ff6b6b; }
    h3, h4 { color: #bbb; }
    code { background: #333; }
    .source-link { color: #999; }
    em { color: #aaa; }
    strong { color: #eee; }
    .separator { color: #666; }
    .toc-h1 { color: #ff6b6b; }
    .toc-h2 { color: #aaa; }
    .figure-caption { color: #888; }
}
"""

# ── 工具函数 ──────────────────────────────────────

def safe_text(text):
    """清理文本"""
    if not text:
        return ""
    return text.strip()

def get_image_map(docx_path):
    """从 docx 中提取所有图片，返回 {rId: (filename, bytes)} """
    image_map = {}
    with zipfile.ZipFile(docx_path) as z:
        # 读取 rels 文件
        rels_files = [n for n in z.namelist() if n.endswith('.rels') and 'word/' in n]
        for rels_file in rels_files:
            try:
                rels_xml = etree.fromstring(z.read(rels_file))
                ns = {'r': 'http://schemas.openxmlformats.org/package/2006/relationships'}
                for rel in rels_xml.findall('.//r:Relationship', ns):
                    rtype = rel.get('Type', '')
                    if 'image' in rtype.lower():
                        rid = rel.get('Id')
                        target = rel.get('Target')
                        # 构建完整路径
                        base = os.path.dirname(rels_file)
                        full_target = os.path.normpath(os.path.join(base, target)).replace('\\', '/')
                        if full_target in z.namelist():
                            ext = os.path.splitext(target)[1].lower()
                            if ext in ('.jpg', '.jpeg'):
                                mime = 'image/jpeg'
                            elif ext == '.png':
                                mime = 'image/png'
                            elif ext == '.gif':
                                mime = 'image/gif'
                            elif ext == '.bmp':
                                mime = 'image/bmp'
                            else:
                                mime = 'image/jpeg'
                            image_map[rid] = (os.path.basename(target), z.read(full_target), mime)
            except:
                pass
    return image_map

# ── 段落内容提取 ──────────────────────────────────

def extract_paragraph_content(para, image_map):
    """提取段落内容（文本 + 内联图片），返回 HTML 字符串列表"""
    results = []
    xml = para._element
    
    # 命名空间
    nsmap = {
        'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
        'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
        'pic': 'http://schemas.openxmlformats.org/drawingml/2006/picture',
        'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    }
    
    for child in xml.iter():
        tag = etree.QName(child.tag).localname if hasattr(child, 'tag') else ''
        
        # 图片
        if tag == 'blip':
            embed = child.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
            if embed and embed in image_map:
                fname, data, mime = image_map[embed]
                # 将图片保存到临时目录
                img_path = WORK_DIR / 'images' / fname
                img_path.parent.mkdir(parents=True, exist_ok=True)
                img_path.write_bytes(data)
                results.append(('image', fname, mime))
        
        # 文本运行
        if tag == 't':
            text = child.text or ''
            # 检查是否粗体/斜体
            parent = child.getparent()
            is_bold = False
            is_italic = False
            if parent is not None:
                for prop in parent.iter():
                    ptag = etree.QName(prop.tag).localname
                    if ptag == 'b' and prop.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val') != 'false':
                        is_bold = True
                    if ptag == 'i' and prop.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val') != 'false':
                        is_italic = True
            
            if text.strip():
                formatted = text
                if is_bold:
                    formatted = f'<strong>{formatted}</strong>'
                if is_italic:
                    formatted = f'<em>{formatted}</em>'
                results.append(('text', formatted))
    
    return results

def is_empty_para(para):
    """判断段落是否为空"""
    if not para:
        return True
    text = para.text.strip() if para.text else ''
    if text:
        return False
    # 检查是否包含图片
    xml = para._element
    blips = xml.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/main}blip')
    if blips:
        return False
    drawings = xml.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}inline')
    if drawings:
        return False
    return True

# ── 主转换 ────────────────────────────────────────

def convert():
    print("📖 读取 docx...")
    doc = docx.Document(DOCX_PATH)
    
    print(f"   段落数: {len(doc.paragraphs)}")
    
    print("🖼️  提取图片...")
    image_map = get_image_map(DOCX_PATH)
    print(f"   图片数: {len(image_map)}")
    
    # 清理并创建工作目录
    if WORK_DIR.exists():
        shutil.rmtree(WORK_DIR)
    WORK_DIR.mkdir(parents=True)
    
    # ── 第一遍：分析结构，找出章节边界 ──
    print("📊 分析文档结构...")
    
    chapter_boundaries = []  # [(start_idx, end_idx, level, title)]
    current_chapter_start = None
    current_level = None
    h1_count = 0
    h2_count = 0
    
    for i, para in enumerate(doc.paragraphs):
        style = para.style.name if para.style else ''
        text = para.text.strip() if para.text else ''
        
        if not text and is_empty_para(para):
            continue
        
        if style == 'Heading 1' or style == 'heading 1':
            if current_chapter_start is not None:
                chapter_boundaries.append((current_chapter_start, i, current_level, current_title))
            current_chapter_start = i
            current_level = 1
            current_title = text
            h1_count += 1
        elif style == 'Heading 2' or style == 'heading 2':
            if current_chapter_start is not None:
                chapter_boundaries.append((current_chapter_start, i, current_level, current_title))
            current_chapter_start = i
            current_level = 2
            current_title = text
            h2_count += 1
        elif style == 'Heading 3' or style == 'heading 3':
            if current_chapter_start is not None:
                chapter_boundaries.append((current_chapter_start, i, current_level, current_title))
            current_chapter_start = i
            current_level = 3
            current_title = text
    
    # 最后一个章节
    if current_chapter_start is not None:
        chapter_boundaries.append((current_chapter_start, len(doc.paragraphs), current_level, current_title))
    
    print(f"   一级标题(H1): {h1_count}, 二级标题(H2): {h2_count}")
    print(f"   章节数: {len(chapter_boundaries)}")
    
    # 合并首章（标题前的目录等内容）
    if chapter_boundaries and chapter_boundaries[0][0] > 0:
        chapter_boundaries.insert(0, (0, chapter_boundaries[0][0], 0, "目录"))
    
    # ── 第二遍：生成 EPUB ──
    print("📝 生成 EPUB...")
    
    book = epub.EpubBook()
    book.set_identifier('huashan-bazi-teaching')
    book.set_title(TITLE)
    book.set_language(LANGUAGE)
    book.add_author(AUTHOR)
    book.add_metadata('DC', 'description', '华山八字教学全系列，共557篇文章，老陈说易编著')
    book.add_metadata('DC', 'date', '2026-05-31')
    
    # 添加 CSS
    nav_css = epub.EpubItem(
        uid="style_nav",
        file_name="style/nav.css",
        media_type="text/css",
        content=CSS.encode('utf-8')
    )
    book.add_item(nav_css)
    
    # 处理每个章节
    epub_chapters = []
    spine = ['nav']
    toc_entries = []
    
    image_counter = [0]  # 使用列表以便在闭包中修改
    
    # 判断段落是否是分隔线
    def is_separator(text):
        if not text:
            return False
        # 用 em dash 或连续横线构成的分隔线
        if text.replace('—', '').strip() == '' and len(text) > 10:
            return True
        return False
    
    # 判断是否是原文链接
    def is_source_link(text):
        return text.startswith('原文链接：http') or text.startswith('原文链接:http')
    
    # 用于跟踪图片序号
    used_images = set()
    
    for ch_idx, (start, end, level, title) in enumerate(chapter_boundaries):
        # 生成文件名安全的 ID
        safe_id = f"ch{ch_idx:04d}"
        
        # 构建 HTML 内容
        html_parts = []
        html_parts.append(f'<h{max(level, 1) if level > 0 else 1}>{title}</h{max(level, 1) if level > 0 else 1}>\n')
        
        is_first_content_para = True
        
        for pi in range(start, end):
            if pi >= len(doc.paragraphs):
                break
            para = doc.paragraphs[pi]
            text = para.text.strip() if para.text else ''
            style = para.style.name if para.style else ''
            
            # 跳过已经作为标题的段落（第一个段落）
            if pi == start and (style in ('Heading 1', 'Heading 2', 'Heading 3', 'heading 1', 'heading 2', 'heading 3')):
                continue
            
            # 跳过完全空段落
            if not text:
                # 检查是否有图片
                has_image = False
                xml = para._element
                blips = xml.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/main}blip')
                if not blips:
                    drawings = xml.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}inline')
                    if not drawings:
                        continue
                    has_image = True
                else:
                    has_image = True
                
                if not has_image:
                    continue
            
            # 处理图片
            xml = para._element
            nsmap = {
                'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
                'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
                'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
            }
            
            # 查找所有图片引用
            blips = xml.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/main}blip')
            if blips:
                for blip in blips:
                    embed = blip.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
                    if embed and embed in image_map:
                        fname, data, mime = image_map[embed]
                        if fname not in used_images:
                            # 添加图片到 EPUB
                            image_counter[0] += 1
                            epub_img = epub.EpubImage()
                            epub_img.file_name = f'images/{fname}'
                            epub_img.media_type = mime
                            epub_img.content = data
                            book.add_item(epub_img)
                            used_images.add(fname)
                        
                        html_parts.append(f'<div class="figure"><img src="images/{fname}" alt="图片"/></div>\n')
            
            # 处理文本
            if text:
                # 特殊处理
                if is_separator(text):
                    html_parts.append('<p class="separator">———</p>\n')
                elif is_source_link(text):
                    html_parts.append(f'<p class="source-link">{text}</p>\n')
                elif style in ('Heading 2', 'heading 2'):
                    html_parts.append(f'<h2>{text}</h2>\n')
                elif style in ('Heading 3', 'heading 3'):
                    html_parts.append(f'<h3>{text}</h3>\n')
                elif style in ('Heading 4', 'heading 4'):
                    html_parts.append(f'<h4>{text}</h4>\n')
                else:
                    cls = 'no-indent' if is_first_content_para else ''
                    html_parts.append(f'<p class="{cls}">{text}</p>\n')
                    is_first_content_para = False
        
        html_content = '\n'.join(html_parts)
        
        # 创建 EPUB 章节
        chapter = epub.EpubHtml(
            title=title,
            file_name=f'text/{safe_id}.xhtml',
            lang=LANGUAGE
        )
        chapter.content = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="{LANGUAGE}">
<head>
<meta charset="UTF-8"/>
<title>{title}</title>
<link rel="stylesheet" type="text/css" href="../style/nav.css"/>
</head>
<body>
{html_content}
</body>
</html>'''.encode('utf-8')
        
        book.add_item(chapter)
        epub_chapters.append(chapter)
        spine.append(chapter)
        
        # TOC 条目
        toc_entry = epub.Link(f'text/{safe_id}.xhtml', title, safe_id)
        toc_entries.append(toc_entry)
    
    # ── 设置目录和书脊 ──
    book.toc = toc_entries
    book.spine = spine
    
    # 添加必要的 EPUB 项目
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    
    # ── 写入文件 ──
    print(f"💾 写入 EPUB ({len(epub_chapters)} 个章节)...")
    epub.write_epub(OUTPUT_EPUB, book)
    
    file_size = os.path.getsize(OUTPUT_EPUB)
    print(f"\n✅ 完成！")
    print(f"   输出文件: {OUTPUT_EPUB}")
    print(f"   文件大小: {file_size / 1024 / 1024:.1f} MB")
    print(f"   章节数: {len(epub_chapters)}")
    print(f"   图片数: {len(used_images)}")

if __name__ == '__main__':
    convert()
