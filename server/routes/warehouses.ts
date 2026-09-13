import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { db } from "../db";
import { warehouses } from "../db/schema";
import { eq, isNull } from "drizzle-orm";
import { requireRole } from "../middleware/auth";

const router = Router();

const warehouseSchema = z.object({
  name: z.string().min(2, "نام انبار الزامی است"),
  code: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  manager: z.string().optional().nullable(),
  capacity: z.coerce.number().optional().nullable(),
});

// GET /api/warehouses - List all warehouses
router.get("/", async (_req, res) => {
  try {
    const list = await db.select().from(warehouses).where(isNull(warehouses.deletedAt));
    res.json({ success: true, data: list });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || "خطا در دریافت لیست انبارها" });
  }
});

// POST /api/warehouses - Create warehouse
router.post("/", requireRole("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const parsed = warehouseSchema.parse(req.body);
    const newWarehouse = {
      id: randomUUID(),
      name: parsed.name,
      code: parsed.code || null,
      location: parsed.location || null,
      manager: parsed.manager || null,
      capacity: parsed.capacity != null ? String(parsed.capacity) : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(warehouses).values(newWarehouse);
    res.status(201).json({ success: true, data: newWarehouse });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.issues[0]?.message });
    }
    res.status(500).json({ success: false, error: error?.message || "خطا در ثبت انبار" });
  }
});

// PUT /api/warehouses/:id - Update warehouse
router.put("/:id", requireRole("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const parsed = warehouseSchema.partial().parse(req.body);
    const updatePayload: any = { updatedAt: new Date() };
    if (parsed.name) updatePayload.name = parsed.name;
    if (parsed.code !== undefined) updatePayload.code = parsed.code;
    if (parsed.location !== undefined) updatePayload.location = parsed.location;
    if (parsed.manager !== undefined) updatePayload.manager = parsed.manager;
    if (parsed.capacity !== undefined) updatePayload.capacity = parsed.capacity != null ? String(parsed.capacity) : null;

    await db.update(warehouses).set(updatePayload).where(eq(warehouses.id, id));
    res.json({ success: true, message: "انبار با موفقیت به‌روزرسانی شد" });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.issues[0]?.message });
    }
    res.status(500).json({ success: false, error: error?.message || "خطا در ویرایش انبار" });
  }
});

// DELETE /api/warehouses/:id - Soft delete warehouse
router.delete("/:id", requireRole("ADMIN"), async (req, res) => {
  try {
    const id = String(req.params.id);
    await db.update(warehouses).set({ deletedAt: new Date() }).where(eq(warehouses.id, id));
    res.json({ success: true, message: "انبار حذف گردید" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || "خطا در حذف انبار" });
  }
});

export default router;
