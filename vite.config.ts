import { readFileSync } from "node:fs";
import { settingsApi } from "./server/settings.ts";
import { analysisApi } from "./server/analysis.ts";
import { defineConfig } from "vite";
import { createTransfer } from "./server/transfer.ts";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(
      JSON.parse(
        readFileSync(new URL("./package.json", import.meta.url), "utf8"),
      ).version,
    ),
    __BUILD_VERSION__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    {
      name: "local-phone-transfer",
      configureServer(server) {
        const transfer = createTransfer();
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith("/api/settings")) void settingsApi(req, res);
          else if (req.url?.startsWith("/api/analysis/"))
            void analysisApi(req, res);
          else if (req.url?.startsWith("/api/phone/"))
            void transfer.desktop(req, res);
          else next();
        });
        server.httpServer?.on("close", () => void transfer.dispose());
      },
    },
  ],
});
