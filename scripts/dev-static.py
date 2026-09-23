"""Serveur local : /home sert home.html, comme Nginx en production."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
import urllib.parse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
os.chdir(ROOT)


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        parsed = urllib.parse.urlsplit(path)
        rel = urllib.parse.unquote(parsed.path).lstrip("/")
        if not rel:
            rel = "index.html"
        candidate = os.path.normpath(os.path.join(ROOT, rel))
        if not candidate.startswith(ROOT):
            candidate = os.path.join(ROOT, "index.html")
        if not os.path.exists(candidate) and os.path.exists(candidate + ".html"):
            candidate = candidate + ".html"
        return candidate


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    print(f"http://127.0.0.1:{port}/", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
