import { z } from 'zod';

/**
 * User roles for authorization and access control within OpsLens.
 */
export const RoleEnum = z.enum(['worker', 'maintenance', 'supervisor', 'manager', 'admin']);

/**
 * Inferred TypeScript type for user roles.
 */
export type Role = z.infer<typeof RoleEnum>;

/**
 * Runtime Zod schema for authenticated user context passed from the authorizer.
 */
export const AuthContextSchema = z.object({
  tenantId: z.string().min(1, 'Tenant ID must not be empty'),
  userId: z.string().min(1, 'User ID must not be empty'),
  role: RoleEnum,
  email: z.string().email('Email must be a valid email address'),
});

/**
 * Inferred TypeScript type representing the verified caller authentication context.
 */
export type AuthContext = z.infer<typeof AuthContextSchema>;
