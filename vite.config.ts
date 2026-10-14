import { defineConfig } from "vite";
import { createTransfer } from "./server/transfer.ts";

export default defineConfig({
  plugins: [
    {
      name: "local-phone-transfer",
      configureServer(server) {
        const transfer = createTransfer();
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith("/api/phone/"))
            void transfer.desktop(req, res);
          else next();
        });
        server.httpServer?.on("close", () => void transfer.dispose());
      },
    },
  ],
});
