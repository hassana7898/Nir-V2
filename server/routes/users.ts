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

export default router;
