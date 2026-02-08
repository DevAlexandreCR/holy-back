import { UserRole } from '@prisma/client'

const ROLE_HIERARCHY: Record<UserRole, number> = {
  USER: 0,
  EDITOR: 1,
  LEAD: 2,
  ADMIN: 3,
}

const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  USER: ['read:bible', 'read:verse', 'save:favorites', 'use:widget'],
  EDITOR: ['read:bible', 'read:verse', 'save:favorites', 'use:widget', 'manage:bible', 'manage:devotionals'],
  LEAD: [
    'read:bible',
    'read:verse',
    'save:favorites',
    'use:widget',
    'manage:bible',
    'manage:devotionals',
    'view:analytics',
    'manage:editors',
  ],
  ADMIN: [
    'read:bible',
    'read:verse',
    'save:favorites',
    'use:widget',
    'manage:bible',
    'manage:devotionals',
    'view:analytics',
    'manage:editors',
    'manage:users',
    'assign:roles',
    'manage:system',
  ],
}

export const hasMinimumRole = (userRole: UserRole, requiredRole: UserRole): boolean => {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole]
}

export const canManageRole = (managerRole: UserRole, _targetRole: UserRole): boolean => {
  if (managerRole !== UserRole.ADMIN) return false
  return true
}

export const getRolePermissions = (role: UserRole): string[] => {
  return ROLE_PERMISSIONS[role] ?? []
}
