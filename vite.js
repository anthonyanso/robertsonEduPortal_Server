const express = require("express");
const fs = require("fs");
const path = require("path");
let viteConfig;
if (process.env.NODE_ENV === "development") {
    viteConfig = require("../vite.config");
}
const { nanoid } = require("nanoid");

let viteLogger;

async function setupVite(app, server) {
    const viteModule = await import("vite");
    const { createServer: createViteServer, createLogger } = viteModule;
    viteLogger = createLogger();
    const serverOptions = {
        middlewareMode: true,
        hmr: { server },
        allowedHosts: true,
    };
    const vite = await createViteServer(Object.assign(Object.assign({}, viteConfig), { configFile: false, customLogger: Object.assign(Object.assign({}, viteLogger), { error: (msg, options) => {
                viteLogger.error(msg, options);
                process.exit(1);
            } }), server: serverOptions, appType: "custom" }));
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
        const url = req.originalUrl;
        try {
            const clientTemplate = path.resolve(__dirname, "..", "src", "index.html");
            // always reload the index.html file from disk incase it changes
            let template = await fs.promises.readFile(clientTemplate, "utf-8");
            template = template.replace(`src="/src/main.tsx"`, `src="/src/main.tsx?v=${nanoid()}"`);
            const page = await vite.transformIndexHtml(url, template);
            res.status(200).set({ "Content-Type": "text/html" }).end(page);
        }
        catch (e) {
            vite.ssrFixStacktrace(e);
            next(e);
        }
    });
}

function log(message, source = "express") {
    const formattedTime = new Date().toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    });
    console.log(`${formattedTime} [${source}] ${message}`);
}

function serveStatic(app) {
    const distPath = path.resolve(__dirname, "public");
    if (!fs.existsSync(distPath)) {
        throw new Error(`Could not find the build directory: ${distPath}, make sure to build the client first`);
    }
    app.use(express.static(distPath));
    // fall through to index.html if the file doesn't exist
    app.use("*", (_req, res) => {
        res.sendFile(path.resolve(distPath, "index.html"));
    });
}

module.exports = {
  setupVite,
  log,
  serveStatic
};
