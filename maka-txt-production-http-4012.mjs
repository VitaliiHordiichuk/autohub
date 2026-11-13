import { app } from "./src/app.js";

const server = app.listen(4012, "127.0.0.1");

server.on("error", error => {
  console.error("HTTP_START_FAILED", error.code);
  process.exit(1);
});
