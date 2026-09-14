import express from "express";
import path from "path";
import fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

import { db, checkDbHealth } from "./server/db";
import { GoogleGenAI, Type } from "@google/genai";

import { securityHeaders } from "./server/middleware/security";
import { corsMiddleware } from "./server/middleware/cors";
import { apiRateLimiter, authRateLimiter } from "./server/middleware/rateLimit";
import { requireAuth } from "./server/middleware/auth";

import authRouter from "./server/routes/auth";
import settingsRouter from "./server/routes/settings";
import farmersRouter from "./server/routes/farmers";
import driversRouter from "./server/routes/drivers";
import originsRouter from "./server/routes/origins";
import invoicesRouter from "./server/routes/invoices";
import inventoryRouter from "./server/routes/inventory";
import productionRouter from "./server/routes/production";
import formulasRouter from "./server/routes/formulas";
import warehousesRouter from "./server/routes/warehouses";
import usersRouter from "./server/routes/users";
import syncRouter from "./server/routes/sync";
import backupRouter from "./server/routes/backup";
import uploadRouter from "./server/routes/uploads";

export const app = express();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
// Bind host: env-driven, defaulting to loopback. Production must never expose the
// app port directly; nginx proxies to it.
const HOST = (process.env.HOST || "127.0.0.1").trim() || "127.0.0.1";

// Nginx runs on this host and forwards the real client IP. Trusting only the loopback
// proxy makes req.ip (used by the rate limiters) the actual client.
app.set("trust proxy", "loopback");

app.use(securityHeaders);
app.use(corsMiddleware);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const uploadsPath = path.resolve(
  process.env.UPLOAD_DIR || process.env.NIR_UPLOADS_PATH || path.join(process.cwd(), "data", "uploads")
);
app.use("/uploads", express.static(uploadsPath));

// ---------------------------------------------------------------- health
app.get("/api/health", async (_req, res) => {
  const database = await checkDbHealth();
  const healthy = database.status === "connected";
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    service: "nir-production",
    database,
    time: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------- auth
app.use("/api/auth", authRateLimiter, authRouter);

// -------------------------------------------------- authenticated business APIs
app.use("/api/settings", apiRateLimiter, requireAuth, settingsRouter);
app.use("/api/farmers", apiRateLimiter, requireAuth, farmersRouter);
app.use("/api/drivers", apiRateLimiter, requireAuth, driversRouter);
app.use("/api/origins", apiRateLimiter, requireAuth, originsRouter);
app.use("/api/invoices", apiRateLimiter, requireAuth, invoicesRouter);
app.use("/api/inventory", apiRateLimiter, requireAuth, inventoryRouter);
app.use("/api/production", apiRateLimiter, requireAuth, productionRouter);
app.use("/api/formulas", apiRateLimiter, requireAuth, formulasRouter);
app.use("/api/warehouses", apiRateLimiter, requireAuth, warehousesRouter);
app.use("/api/users", apiRateLimiter, requireAuth, usersRouter);
app.use("/api/sync", apiRateLimiter, requireAuth, syncRouter);
app.use("/api/backup", apiRateLimiter, requireAuth, backupRouter);
app.use("/api/uploads", apiRateLimiter, requireAuth, uploadRouter);

// ---------------------------------------------------------------- AI extraction
let ai: GoogleGenAI | null = null;
const getGeminiClient = (): GoogleGenAI | null => {
  if (!ai && process.env.GEMINI_API_KEY) ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return ai;
};

app.post("/api/extract", apiRateLimiter, requireAuth, async (req, res) => {
  try {
    const { base64Data, mimeType, type, knownFarmers, knownProducts, knownDrivers } = req.body;
    const client = getGeminiClient();
    if (!client) return res.status(503).json({ error: "API Key (GEMINI_API_KEY) is missing." });

    const responseSchema = type === 'entry' ? {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sellerName: { type: Type.STRING, nullable: true },
          productName: { type: Type.STRING, nullable: true },
          billWeight: { type: Type.NUMBER, nullable: true },
          scaleWeight: { type: Type.NUMBER, nullable: true },
          driverName: { type: Type.STRING, nullable: true },
          billNumber: { type: Type.STRING, nullable: true },
          origin: { type: Type.STRING, nullable: true },
          transportCost: { type: Type.NUMBER, nullable: true },
          driverPhone: { type: Type.STRING, nullable: true },
          driverIBAN: { type: Type.STRING, nullable: true }
        }
      }
    } : {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          farmerName: { type: Type.STRING, nullable: true },
          productName: { type: Type.STRING, nullable: true },
          weight: { type: Type.NUMBER, nullable: true },
          driverName: { type: Type.STRING, nullable: true },
          invoiceNumber: { type: Type.STRING, nullable: true }
        }
      }
    };

    const kf = knownFarmers && knownFarmers.length > 0 ? `\nKnown Farmers/Sellers: ${knownFarmers.join(", ")}` : "";
    const kp = knownProducts && knownProducts.length > 0 ? `\nKnown Products: ${knownProducts.join(", ")}` : "";
    const kd = knownDrivers && knownDrivers.length > 0 ? `\nKnown Drivers: ${knownDrivers.join(", ")}` : "";
    const contextStr = `${kf}${kp}${kd}`;

    const promptText = type === 'entry'
      ? `Task: Extract Persian raw materials entry remittance data from this image/pdf (Right-to-Left).
Return a JSON Array of objects.
Columns mapped to JSON keys:
- Seller Name (فروشنده) -> sellerName
- Product (نام کالا) -> productName
- Bill Weight (وزن بارنامه) -> billWeight (number)
- Scale Weight (وزن باسکول) -> scaleWeight (number)
- Factory (کارخانه) -> factory
- Driver (راننده) -> driverName
- Bill Number (شماره بارنامه) -> billNumber
- Origin (مبدا) -> origin
- Transport Cost (کرایه) -> transportCost (number)
- Driver Phone (تلفن) -> driverPhone
- Driver IBAN (شبا) -> driverIBAN

CRITICAL RULES FOR EXTRACTION:
1. SEPARATION OF SELLER AND PRODUCT: The image often physically merges Seller name and Product name. You MUST separate them.
2. Example of bad output: sellerName="حسین ذرت", productName=null
3. Example of good output: sellerName="حسین", productName="ذرت"

CONTEXT (Known Values to Help You):${contextStr}`
      : `Task: Extract Persian exit remittance data from this image/pdf (Right-to-Left).
Return a JSON Array of objects.
Columns mapped to JSON keys:
- Farmer Name (مرغدار) -> farmerName
- Product (نام کالا) -> productName
- Weight (وزن) -> weight (number)
- Driver (راننده) -> driverName
- Invoice No (شماره فاکتور) -> invoiceNumber

CRITICAL RULES FOR EXTRACTION:
1. SEPARATION OF FARMER AND PRODUCT: The image often physically merges Farmer name and Product name. You MUST separate them.

CONTEXT (Known Values to Help You):${contextStr}`;

    const response = await client.models.generateContent({
      model: 'gemini-1.5-pro',
      contents: { parts: [{ inlineData: { mimeType, data: base64Data } }, { text: promptText }] },
      config: { responseMimeType: "application/json", responseSchema }
    });

    if (!response.text) return res.status(500).json({ error: "Empty response from Gemini." });
    res.json(JSON.parse(response.text.trim()));
  } catch (error: any) {
    console.error("Gemini Extraction Error:", error);
    res.status(500).json({ error: error.message || "Unknown error during AI extraction." });
  }
});

// ---------------------------------------------------------------- API 404
app.all(/^\/api\/.*/, (req, res) => {
  res.status(404).json({ success: false, error: { code: 'SERVER_ERROR', message: 'API endpoint not found', path: req.originalUrl } });
});

// ---------------------------------------------------------------- error handler
const errorHandler = (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[NIR Server Error]', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    error: { code: 'SERVER_ERROR', message: err?.message || 'خطای داخلی سرور.' },
    ...(process.env.NODE_ENV !== 'production' ? { stack: err?.stack } : {})
  });
};

// ---------------------------------------------------------------- bootstrap
async function startServer() {
  if ((db as any).migrateDb) {
    await (db as any).migrateDb();
    console.log("[NIR] PGLite test database migrated (non-production only).");
  }

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.env.NIR_DIST_PATH || path.join(process.cwd(), 'dist'));
    const assetsPath = path.join(distPath, 'assets');
    app.use('/assets', express.static(assetsPath, { fallthrough: false, immutable: true, maxAge: '1y' }));
    app.use(express.static(distPath, { index: 'index.html', fallthrough: true }));
    app.get(/^(?!\/api(?:\/|$)|\/uploads(?:\/|$)|\/assets(?:\/|$)).*$/, (_req, res) => {
      res.sendFile('index.html', { root: distPath });
    });
    app.use('/assets', (_req, res) => res.status(404).send('Asset not found'));
  }

  app.use(errorHandler);

  app.listen(PORT, HOST, () => console.log(`[NIR] Server running on http://${HOST}:${PORT}`));
}

startServer();
