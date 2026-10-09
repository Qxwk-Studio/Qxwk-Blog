/* 正文渲染管线：esc / resolveRel / sanitizeHtml / loadMarked / renderMarkdown
 *
 * 首页阅读器与「佳作集」页共用这一份。之所以抽出来而不是各留一份：sanitizeHtml 是安全
 * 边界（正文可能来自陌生投稿），两处实现一旦漂移，等于留了个洞。改这里，两边同时生效。
 *
 * 本站无构建，用普通 <script> 引入并挂在 window.Mag 上，不走 ESM。 */
(function () {
    'use strict';

    function esc(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; }

    // marked 解析后的 HTML 做一次最小消毒：正文可能来自外部，必须挡住 <script>、内联事件、javascript: URL
    var BAD_TAGS = { SCRIPT:1, STYLE:1, IFRAME:1, OBJECT:1, EMBED:1, FORM:1, INPUT:1, BUTTON:1, LINK:1, META:1, BASE:1 };

    // 正文里的相对图片/链接是相对「文章所在目录」的（md 与插图同放 magazine/<期id>/ 下）
    // 浏览器默认按文档基址解析，会把 pic.png 指到站点根，故在此手动补前缀
    function resolveRel(v, baseDir) {
        if (!v || !baseDir) return v;
        if (/^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(v)) return v; // 绝对 URL / 协议相对 / 锚点 / 站点根路径
        return baseDir + v;
    }

    function sanitizeHtml(html, baseDir) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var all = doc.body.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (BAD_TAGS[el.tagName]) { el.remove(); continue; }
            var attrs = el.attributes;
            for (var j = attrs.length - 1; j >= 0; j--) {
                var name = attrs[j].name.toLowerCase();
                var val = attrs[j].value;
                if (name.indexOf('on') === 0) { el.removeAttribute(attrs[j].name); continue; }
                if ((name === 'href' || name === 'src' || name === 'xlink:href') &&
                    /^\s*(javascript|vbscript|data):/i.test(val)) {
                    el.removeAttribute(attrs[j].name);
                }
            }
            if (el.tagName === 'IMG') el.setAttribute('src', resolveRel(el.getAttribute('src'), baseDir));
            else if (el.tagName === 'A') el.setAttribute('href', resolveRel(el.getAttribute('href'), baseDir));
        }
        return doc.body.innerHTML;
    }

    // marked 按需加载：列表页用不到它（约 39KB），只有准备渲染正文时才注入。
    // 路径写成站点根绝对路径，页面在根或在子目录（如 /featured/）都能命中。
    // 失败也 resolve，让 renderMarkdown 走纯文本兜底，不因为一个渲染器把文章卡住
    var _markedLoading = null;
    function loadMarked() {
        if (window.marked) return Promise.resolve();
        if (!_markedLoading) {
            _markedLoading = new Promise(function (resolve) {
                var s = document.createElement('script');
                s.src = '/vendor/marked.min.js';
                s.onload = resolve;
                s.onerror = resolve;
                document.head.appendChild(s);
            });
        }
        return _markedLoading;
    }

    function renderMarkdown(md, baseDir) {
        var src = String(md == null ? '' : md);
        if (window.marked && typeof window.marked.parse === 'function') {
            try { return sanitizeHtml(window.marked.parse(src), baseDir); } catch (e) { /* 落到下面的纯文本兜底 */ }
        }
        // marked 不可用（脚本未加载）时退化为纯文本，至少不丢内容
        return '<p>' + esc(src).replace(/\n/g, '<br>') + '</p>';
    }

    window.Mag = {
        esc: esc,
        resolveRel: resolveRel,
        sanitizeHtml: sanitizeHtml,
        loadMarked: loadMarked,
        renderMarkdown: renderMarkdown
    };
})();