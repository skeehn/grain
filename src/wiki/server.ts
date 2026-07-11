import { createServer, type Server } from 'http';
import { WikiEngine } from './engine.js';

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function renderWikiHtml(wiki: WikiEngine, requestUrl = '/'): { html: string; csp: string } {
  const url = new URL(requestUrl, 'http://127.0.0.1');
  const query = url.searchParams.get('q') || '';
  const pages = query ? wiki.search(query) : wiki.pages();
  const selected = url.pathname.startsWith('/page/') ? wiki.get(decodeURIComponent(url.pathname.slice(6))) : undefined;
  const verification = wiki.verify();
  const body = selected ? `<article><h1>${escape(selected.title)}</h1><pre>${escape(selected.body)}</pre></article>`
    : `<h1>Grain Wiki</h1><form><input name="q" value="${escape(query)}" placeholder="Search"><button>Search</button></form>
      <p>${verification.valid ? 'Current' : `${verification.stale.length} stale references`}</p><ul>${pages.map(page => `<li><a href="/page/${encodeURIComponent(page.id)}">${escape(page.title)}</a></li>`).join('')}</ul>`;
  return { csp: "default-src 'none'; style-src 'unsafe-inline'",
    html: `<!doctype html><meta name="viewport" content="width=device-width"><title>Grain Wiki</title><style>body{font:16px ui-monospace,monospace;max-width:960px;margin:4rem auto;padding:0 1rem;background:#111;color:#e7e0d2}a{color:#d6a85f}input,button{font:inherit;padding:.6rem;background:#211f1b;color:inherit;border:1px solid #817d73}pre{white-space:pre-wrap}</style>${body}` };
}

export function startWikiServer(port = 7331, host = '127.0.0.1', wiki = new WikiEngine()): Server {
  if (host !== '127.0.0.1' && host !== 'localhost' && process.env.GRAIN_WIKI_ALLOW_REMOTE !== '1') {
    throw new Error('Remote wiki binding requires GRAIN_WIKI_ALLOW_REMOTE=1');
  }
  return createServer((request, response) => {
    const rendered = renderWikiHtml(wiki, request.url || '/');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': rendered.csp });
    response.end(rendered.html);
  }).listen(port, host);
}
