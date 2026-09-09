import http.server, json, sys
class H(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def do_GET(self):
        rec = {"method": self.command, "path": self.path, "headers": dict(self.headers)}
        print(json.dumps(rec, indent=2), flush=True)
        body = b"<html><body>sink</body></html>"
        self.send_response(200)
        self.send_header('Content-Type','text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', 3000), H).serve_forever()
