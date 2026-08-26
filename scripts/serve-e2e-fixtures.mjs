import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";

const host = "127.0.0.1";
const port = 41_739;
const articlePath = resolve("tests/e2e/fixtures/article.html");

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", `http://${host}:${port}`)
    .pathname;

  response.setHeader("Cache-Control", "no-store");
  if (pathname === "/health") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("ok");
    return;
  }
  if (pathname === "/article.html" || pathname === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    createReadStream(articlePath).pipe(response);
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

server.listen(port, host, () => {
  process.stdout.write(`Speak-O E2E fixtures: http://${host}:${port}\n`);
});

const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
