

require('dotenv/config');
const express = require('express');
const { registerRoutes } = require('./routes');
let setupVite, serveStatic, log;
if (process.env.NODE_ENV === 'development') {
  ({ setupVite, serveStatic, log } = require('./vite'));
} else {
  // Only require serveStatic and log for production, skip Vite
  ({ serveStatic, log } = require('./vite'));
}


const app = express();
app.use(express.json({ limit: '50mb' })); // Increased limit for passport photos
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on('finish', () => {
    const duration = Date.now() - start;
    if (path.startsWith('/api')) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + '…';
      }
      log(logLine);
    }
  });
  next();
});

// Add a root route to confirm the server is running
app.get('/', (_req, res) => {
  res.send('RobertsonEduPortal backend is running!');
});

// Register routes and error handler synchronously for Vercel
registerRoutes(app);

app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  res.status(status).json({ message });
  throw err;
});

// For local development, you can still use vite and static serving
if (process.env.NODE_ENV === 'development' && setupVite) {
  setupVite(app);
} else if (serveStatic) {
  serveStatic(app);
}

// Start server locally and log message
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log('RobertsonEduPortal backend is running!');
  });
}

// Export a handler for Vercel serverless deployment
module.exports = (req, res) => app(req, res);