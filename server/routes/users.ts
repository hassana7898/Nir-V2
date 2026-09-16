import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireRole } from "../middleware/auth";

const router = Router();

const userCreateSchema = z.object({
  username: z.string().min(3, "نام کاربری باید حداقل ۳ کاراکتر باشد"),
  password: z.string().min(6, "رمز عبور باید حداقل ۶ کاراکتر باشد"),
  role: z.enum(["ADMIN", "MANAGER", "ACCOUNTING", "OPERATOR", "VIEWER"], {
    message: "نقش نامعتبر است (ADMIN, MANAGER, ACCOUNTING, OPERATOR, VIEWER)"
  }),
  fullName: z.string().optional().nullable(),
});

const userUpdateSchema = z.object({
  role: z.enum(["ADMIN", "MANAGER", "ACCOUNTING", "OPERATOR", "VIEWER"], {
    message: "نقش نامعتبر است (ADMIN, MANAGER, ACCOUNTING, OPERATOR, VIEWER)"
  }).optional(),
  fullName: z.string().optional().nullable(),
}).refine((data) => data.role !== undefined || data.fullName !== undefined, {
  message: "هیچ فیلدی برای به‌روزرسانی ارسال نشده است"
});

const userPasswordSchema = z.object({
  newPassword: z.string().min(6, "رمز عبور باید حداقل ۶ کاراکتر باشد"),
});

// GET /api/users - List users (Admin/Manager only)
router.get("/", requireRole("ADMIN", "MANAGER"), async (_req, res) => {
  try {
    const list = await db.select({
      id: users.id,
      username: users.username,
      role: users.role,
      fullName: users.fullName,
      createdAt: users.createdAt,
    }).from(users);
    res.json({ success: true, data: list });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || "خطا در دریافت کاربران" });
  }
});

// POST /api/users - Create user (Admin only)
router.post("/", requireRole("ADMIN"), async (req, res) => {
  try {
    const parsed = userCreateSchema.parse(req.body);
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.username, parsed.username)).limit(1);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, error: "این نام کاربری قبلاً ثبت شده است" });
    }

    const passwordHash = await bcrypt.hash(parsed.password, 12);
    const newUser = {
      id: randomUUID(),
      username: parsed.username,
      passwordHash,
      role: parsed.role,
      fullName: parsed.fullName || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(users).values(newUser);
    res.status(201).json({
      success: true,
      data: {
        id: newUser.id,
        username: newUser.username,
        role: newUser.role,
        fullName: newUser.fullName,
      }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.issues[0]?.message });
    }
    res.status(500).json({ success: false, error: error?.message || "خطا در ایجاد کاربر" });
  }
});

// DELETE /api/users/:id - Delete user (Admin only)
router.delete("/:id", requireRole("ADMIN"), async (req, res) => {
  try {
    const id = String(req.params.id);
    if (req.user?.id === id) {
      return res.status(400).json({ success: false, error: "امکان حذف حساب کاربری جاری وجود ندارد" });
    }
    await db.delete(users).where(eq(users.id, id));
    res.json({ success: true, message: "کاربر با موفقیت حذف شد" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || "خطا در حذف کاربر" });
  }
});

// PATCH /api/users/:id - Update role and/or fullName (Admin only)
router.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const parsed = userUpdateSchema.parse(req.body);

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: "کاربر مورد نظر یافت نشد" });
    }

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (parsed.role !== undefined) updates.role = parsed.role;
    if (parsed.fullName !== undefined) updates.fullName = parsed.fullName || null;

    await db.update(users).set(updates).where(eq(users.id, id));

    const updated = await db.select({
      id: users.id,
      username: users.username,
      role: users.role,
      fullName: users.fullName,
    }).from(users).where(eq(users.id, id)).limit(1);

    res.json({ success: true, data: updated[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.issues[0]?.message });
    }
    res.status(500).json({ success: false, error: error?.message || "خطا در به‌روزرسانی کاربر" });
  }
});

// PUT /api/users/:id/password - Reset another user's password (Admin only)
router.put("/:id/password", requireRole("ADMIN"), async (req, res) => {
  try {
    const id = String(req.params.id);
    const parsed = userPasswordSchema.parse(req.body);

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: "کاربر مورد نظر یافت نشد" });
    }

    const passwordHash = await bcrypt.hash(parsed.newPassword, 12);
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, id));

    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.issues[0]?.message });
    }
    res.status(500).json({ success: false, error: error?.message || "خطا در تغییر رمز عبور" });
  }
});

export default router;
