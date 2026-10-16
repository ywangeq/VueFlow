import { createServer } from "vite";
import { createStudioServer } from "./index.mjs";
const backend = await createStudioServer();
let vite;
try {
  await new Promise((resolve, reject) => {
    backend.once("error", reject);
    backend.listen(4319, "127.0.0.1", resolve);
  });
  vite = await createServer();
  await vite.listen();
  vite.printUrls();
} catch (error) {
  await vite?.close();
  backend.close();
  throw error;
}
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await vite.close();
  backend.close(() => process.exit(0));
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
