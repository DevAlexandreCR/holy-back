import { Request, Response } from 'express'
import { z } from 'zod'
import { UserRole } from '@prisma/client'
import { AppError } from '../../common/errors'
import { prisma } from '../../config/db'
import { canManageRole, getRolePermissions } from '../../common/utils/permissions'

const updateRoleSchema = z.object({
  role: z.nativeEnum(UserRole),
})

const listSchema = z.object({
  role: z.nativeEnum(UserRole).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

const parseOrThrow = <T>(schema: z.Schema<T>, payload: unknown): T => {
  try {
    return schema.parse(payload)
  } catch (error) {
    throw new AppError('Validation failed', 'VALIDATION_ERROR', 400, error)
  }
}

export const getMyRole = async (req: Request, res: Response) => {
  if (!req.user || !req.user.role) {
    throw new AppError('Unauthorized', 'AUTH_REQUIRED', 401)
  }

  res.json({
    data: {
      userId: req.user.sub,
      role: req.user.role,
      permissions: getRolePermissions(req.user.role),
    },
  })
}

export const updateUserRole = async (req: Request, res: Response) => {
  if (!req.user || !req.user.role) {
    throw new AppError('Unauthorized', 'AUTH_REQUIRED', 401)
  }

  const { userId } = req.params
  const body = parseOrThrow(updateRoleSchema, req.body)

  if (!canManageRole(req.user.role, body.role)) {
    throw new AppError('Insufficient permissions to access this resource', 'FORBIDDEN', 403)
  }

  if (userId === req.user.sub) {
    throw new AppError('Cannot change your own role', 'CANNOT_CHANGE_OWN_ROLE', 400)
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, updatedAt: true },
  })

  if (!targetUser) {
    throw new AppError('User not found', 'USER_NOT_FOUND', 404)
  }

  if (targetUser.role === UserRole.ADMIN && body.role !== UserRole.ADMIN) {
    const adminCount = await prisma.user.count({ where: { role: UserRole.ADMIN } })
    if (adminCount <= 1) {
      throw new AppError('Cannot demote the last admin user', 'LAST_ADMIN', 400)
    }
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { role: body.role },
    select: { id: true, email: true, role: true, updatedAt: true },
  })

  res.json({
    data: {
      userId: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
      updatedAt: updatedUser.updatedAt,
    },
  })
}

export const listUsersWithRoles = async (req: Request, res: Response) => {
  const query = parseOrThrow(listSchema, req.query)
  const where = query.role ? { role: query.role } : {}
  const skip = (query.page - 1) * query.limit

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
      skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ])

  res.json({
    data: {
      users,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    },
  })
}
