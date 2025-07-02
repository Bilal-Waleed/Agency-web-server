import { z } from "zod";

const userRegisterSchema = z.object({
  name: z.string().min(1, "Name is required").max(50, "Name must be less than 50 characters"),
  email: z.string().email("Invalid email address").max(100, "Email must be less than 100 characters"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters long")
    .max(100, "Password must be less than 100 characters"),
  isAdmin: z.boolean().optional().default(false),
  avatar: z.string().optional(),
});

const userLoginSchema = z.object({
  email: z.string().email("Invalid email address").max(100, "Email must be less than 100 characters"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters long")
    .max(100, "Password must be less than 100 characters"),
});

export { userRegisterSchema, userLoginSchema };